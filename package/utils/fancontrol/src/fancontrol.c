/*
 * fancontrol - PWM fan daemon for OpenWrt
 *
 * Reads the H5000M CPU thermal zone from sysfs, maps it through a user-defined
 * temperature-to-PWM curve, and writes the result to a PWM fan device.
 * Designed to run under procd supervision.
 *
 * License: MIT
 */

#include <errno.h>
#include <ctype.h>
#include <limits.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* ---------- tunables ---------- */
#define PATH_MAX_LEN      256
#define CURVE_POINT_COUNT   5
#define CURVE_MAX_TEMP    100
#define CURVE_MAX_PWM     255
#define CURVE_MIN_T_GAP     5
#define HWMON_SCAN_LIMIT    32
#define INTERVAL_MIN         1
#define INTERVAL_MAX      3600
#define TEMP_DIV_DEFAULT  1000
#define TEMP_MIN_VALID     -40
#define TEMP_MAX_VALID     125
#define TEMP_READ_RETRIES    3
#define TEMP_RETRY_US    100000
#define TEMP_FAIL_DEFAULT    10
#define TEMP_FAIL_MIN         1
#define TEMP_FAIL_MAX      3600
#ifndef CPU_THERMAL_FILE
#define CPU_THERMAL_FILE "/sys/class/thermal/thermal_zone0/temp"
#endif

typedef struct { int temp; int speed; } CurvePt;

/* ---------- runtime state ---------- */
static const char tfile[] = CPU_THERMAL_FILE;
static char ffile[PATH_MAX_LEN] = "/sys/class/hwmon/hwmon0/pwm1";
static char sfile[PATH_MAX_LEN] = "";          /* status JSON output path */
static int  tdiv           = TEMP_DIV_DEFAULT;
static int  interval       = 3;
static int  temp_fail_limit = TEMP_FAIL_DEFAULT;
static int  debug          = 0;
static int  status_mode    = 0;
static volatile sig_atomic_t stop_requested;

static CurvePt curve[CURVE_POINT_COUNT] = {
    { 20, 0 }, { 35, 0 }, { 50, 77 }, { 70, 159 }, { 100, 255 }
};
static int npts = CURVE_POINT_COUNT;

/* ---------- helpers ---------- */

static int rf(const char *p, char *b, size_t s)
{
    FILE *f;
    size_t len;

    if (!p || !*p || !b || s == 0 || s > INT_MAX)
        return -1;

    f = fopen(p, "r");
    if (!f)
        return -1;

    if (!fgets(b, (int)(s < INT_MAX ? s : INT_MAX), f)) {
        fclose(f);
        return -1;
    }

    len = strlen(b);
    if (len > 0 && b[len - 1] == '\n')
        b[len - 1] = '\0';

    fclose(f);
    return 0;
}

static int wf(const char *p, const char *b)
{
    FILE *f;

    if (!p || !*p || !b)
        return -1;

    f = fopen(p, "w");
    if (!f)
        return -1;

    if (fputs(b, f) < 0) {
        fclose(f);
        return -1;
    }

    return fclose(f);
}

static int parse_temp_fail_limit(const char *s)
{
    long value;
    char *end;

    if (!s || !*s)
        return TEMP_FAIL_DEFAULT;

    errno = 0;
    value = strtol(s, &end, 10);
    if (end == s || errno == ERANGE)
        return TEMP_FAIL_DEFAULT;

    while (*end && isspace((unsigned char)*end))
        end++;
    if (*end || value < TEMP_FAIL_MIN)
        return TEMP_FAIL_DEFAULT;
    if (value > TEMP_FAIL_MAX)
        return TEMP_FAIL_MAX;

    return (int)value;
}

static int parse_temp_value(const char *s, int div, double *result)
{
    long raw;
    char *end;
    double temp;

    if (!s || !*s || !result)
        return -1;

    errno = 0;
    raw = strtol(s, &end, 10);
    if (end == s || errno == ERANGE)
        return -1;

    while (*end && isspace((unsigned char)*end))
        end++;
    if (*end)
        return -1;

    if (div <= 0)
        div = TEMP_DIV_DEFAULT;

    /* Accept both degrees Celsius and the millidegree values used by sysfs. */
    temp = (raw <= -1000 || raw >= 1000) ? (double)raw / div : (double)raw;
    if (temp < TEMP_MIN_VALID || temp > TEMP_MAX_VALID)
        return -1;

    *result = temp;
    return 0;
}

static int read_temp_with_retry(const char *path, int div, double *result)
{
    for (int i = 0; i < TEMP_READ_RETRIES; i++) {
        char b[32] = {0};
        double t;

        if (rf(path, b, sizeof(b)) == 0) {
            if (parse_temp_value(b, div, &t) == 0) {
                *result = t;
                return 0;
            }
        }

        if (i + 1 < TEMP_READ_RETRIES)
            usleep(TEMP_RETRY_US);
    }

    return -1;
}

/* ---------- sensor access ---------- */

static int cpu_temp(double *result)
{
    return read_temp_with_retry(tfile, tdiv, result);
}

static int fan_pwm(void)
{
    char b[16] = {0};
    return rf(ffile, b, sizeof(b)) ? -1 : atoi(b);
}

static int set_fan_pwm(int speed)
{
    char buf[16];

    snprintf(buf, sizeof(buf), "%d\n", speed);
    return wf(ffile, buf);
}

/* ---------- fan curve ---------- */

static int validate_curve(const CurvePt *pts, int count)
{
    if (!pts || count != CURVE_POINT_COUNT)
        return 0;

    for (int i = 0; i < count; i++) {
        if (pts[i].temp  < 0 || pts[i].temp  > CURVE_MAX_TEMP) return 0;
        if (pts[i].speed < 0 || pts[i].speed > CURVE_MAX_PWM)  return 0;
        if (i > 0 && pts[i].temp  < pts[i - 1].temp + CURVE_MIN_T_GAP) return 0;
        if (i > 0 && pts[i].speed < pts[i - 1].speed) return 0;
    }

    return 1;
}

static void parse_curve(const char *s)
{
    CurvePt next[CURVE_POINT_COUNT];
    char   *d, *t;
    int     i = 0;

    if (!s || !*s)
        return;

    d = strdup(s);
    if (!d)
        return;

    for (t = strtok(d, ","); t; t = strtok(NULL, ",")) {
        int tp, sp;
        char extra;

        if (i >= CURVE_POINT_COUNT || sscanf(t, "%d:%d%c", &tp, &sp, &extra) != 2) {
            free(d);
            return;
        }

        next[i].temp  = tp;
        next[i].speed = sp;
        i++;
    }

    if (validate_curve(next, i)) {
        memcpy(curve, next, (size_t)i * sizeof(next[0]));
        npts = i;
    }

    free(d);
}

static int calc(double T)
{
    double speed = 0.0;

    if (npts == 0)
        return 0;

    if (T <= curve[0].temp) {
        speed = curve[0].speed;
    } else if (T >= curve[npts - 1].temp) {
        speed = curve[npts - 1].speed;
    } else {
        for (int i = 0; i < npts - 1; i++) {
            if (T >= curve[i].temp && T <= curve[i + 1].temp) {
                int r = curve[i + 1].temp - curve[i].temp;
                if (r != 0)
                    speed = curve[i].speed +
                            (double)(curve[i + 1].speed - curve[i].speed) *
                            (T - curve[i].temp) / r;
                else
                    speed = curve[i].speed;
                break;
            }
        }
    }

    if (speed < 0)              return 0;
    if (speed > CURVE_MAX_PWM)  return CURVE_MAX_PWM;
    return (int)(speed + 0.5);
}

/* ---------- signal handling ---------- */

static void exit_handler(int s)
{
    (void)s;
    stop_requested = 1;
}

/* ---------- auto-detection ---------- */

static int access_pwm(const char *path)
{
    return access(path, status_mode ? R_OK : W_OK);
}

static void auto_detect(void)
{
    static const char * const known[] = {
        "/sys/devices/platform/pwm-fan/hwmon/hwmon2/pwm1",
        "/sys/devices/platform/pwm-fan/hwmon/hwmon1/pwm1",
        "/sys/class/hwmon/hwmon2/pwm1",
        "/sys/class/hwmon/hwmon1/pwm1",
        "/sys/class/hwmon/hwmon0/pwm1",
        NULL
    };

    for (int i = 0; known[i]; i++) {
        if (access_pwm(known[i]) == 0) {
            snprintf(ffile, sizeof(ffile), "%s", known[i]);
            return;
        }
    }

    for (int i = 0; i < HWMON_SCAN_LIMIT; i++) {
        char namepath[PATH_MAX_LEN], pwmpath[PATH_MAX_LEN], name[64] = {0};

        snprintf(namepath, sizeof(namepath), "/sys/class/hwmon/hwmon%d/name", i);
        snprintf(pwmpath,  sizeof(pwmpath),  "/sys/class/hwmon/hwmon%d/pwm1", i);

        if (rf(namepath, name, sizeof(name)) == 0 &&
            strcmp(name, "pwmfan") == 0 &&
            access_pwm(pwmpath) == 0) {
            snprintf(ffile, sizeof(ffile), "%s", pwmpath);
            break;
        }
    }
}

/* ---------- JSON output (status mode) ---------- */

static void json_string(const char *s)
{
    putchar('"');
    for (; s && *s; s++) {
        unsigned char c = (unsigned char)*s;
        switch (c) {
        case '"':  putchar('\\'); putchar('"');  break;
        case '\\': putchar('\\'); putchar('\\'); break;
        case '\n': fputs("\\n",  stdout);        break;
        case '\r': fputs("\\r",  stdout);        break;
        case '\t': fputs("\\t",  stdout);        break;
        default:
            if (c < 0x20)
                fprintf(stdout, "\\u%04x", (unsigned int)c);
            else
                putchar(c);
        }
    }
    putchar('"');
}

/* ---------- status file (for LuCI polling without fork/exec) ---------- */

static void json_file_string(FILE *fp, const char *s)
{
    fputc('"', fp);
    for (; s && *s; s++) {
        unsigned char c = (unsigned char)*s;
        switch (c) {
        case '"':  fputc('\\', fp); fputc('"', fp);  break;
        case '\\': fputc('\\', fp); fputc('\\', fp); break;
        case '\n': fputs("\\n", fp);                 break;
        case '\r': fputs("\\r", fp);                 break;
        case '\t': fputs("\\t", fp);                 break;
        default:
            if (c < 0x20)
                fprintf(fp, "\\u%04x", (unsigned int)c);
            else
                fputc(c, fp);
        }
    }
    fputc('"', fp);
}

static void write_status_json(FILE *fp, int temp_valid, double cpu, int p)
{
    fputs("{\"cpu\":", fp);
    if (temp_valid)
        fprintf(fp, "%.1f", cpu);
    else
        fputs("null", fp);
    fprintf(fp, ",\"pwm\":%d,\"thermal_file\":", p);
    json_file_string(fp, tfile);
    fprintf(fp, ",\"fan_file\":");
    json_file_string(fp, ffile);
    fprintf(fp, "}\n");
}

static void write_status_file(int temp_valid, double cpu, int p)
{
    char tmp[PATH_MAX_LEN + 8];
    FILE *fp;

    if (sfile[0] == '\0')
        return;

    if ((size_t)snprintf(tmp, sizeof(tmp), "%s.tmp", sfile) >= sizeof(tmp))
        return;

    fp = fopen(tmp, "w");
    if (!fp)
        return;

    write_status_json(fp, temp_valid, cpu, p);

    if (fclose(fp) != 0) {
        unlink(tmp);
        return;
    }

    if (rename(tmp, sfile) != 0)
        unlink(tmp);
}

static int print_status(void)
{
    double cpu = 0.0;
    int    temp_valid = cpu_temp(&cpu) == 0;
    int    p = fan_pwm();

    fputs("{\"cpu\":", stdout);
    if (temp_valid)
        printf("%.1f", cpu);
    else
        fputs("null", stdout);
    printf(",\"pwm\":%d,\"thermal_file\":", p);
    json_string(tfile);
    printf(",\"fan_file\":");
    json_string(ffile);
    printf("}\n");

    return (temp_valid || p >= 0) ? 0 : 1;
}

/* ---------- main ---------- */

static void setup_signals(void)
{
    struct sigaction sa;

    sigemptyset(&sa.sa_mask);
    sa.sa_flags   = 0;
    sa.sa_handler = exit_handler;

    sigaction(SIGINT,  &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);
}

int main(int argc, char *argv[])
{
    char cs[PATH_MAX_LEN * 8] = {0};  /* curve string buffer */
    int  opt;

    /* Detect "status" sub-command without corrupting argv */
    if (argc > 1 && strcmp(argv[1], "status") == 0) {
        status_mode = 1;
        optind = 2;  /* start getopt at index 2 */
    }

    while ((opt = getopt(argc, argv, "F:S:c:d:i:n:D")) != -1) {
        switch (opt) {
        case 'F':
            if ((size_t)snprintf(ffile, sizeof(ffile), "%s", optarg) >= sizeof(ffile))
                fprintf(stderr, "fancontrol: -F path truncated\n");
            break;
        case 'S':
            if ((size_t)snprintf(sfile, sizeof(sfile), "%s", optarg) >= sizeof(sfile))
                fprintf(stderr, "fancontrol: -S path truncated\n");
            break;
        case 'c':
            if ((size_t)snprintf(cs, sizeof(cs), "%s", optarg) >= sizeof(cs))
                fprintf(stderr, "fancontrol: -c curve truncated\n");
            break;
        case 'd':
            tdiv = atoi(optarg);
            break;
        case 'i':
            interval = atoi(optarg);
            break;
        case 'n':
            temp_fail_limit = parse_temp_fail_limit(optarg);
            break;
        case 'D':
            debug = 1;
            break;
        default:
            fprintf(stderr,
                    "Usage: %s [status] [-F pwm] [-S status_file] [-c curve] "
                    "[-d div] [-i sec] [-n failures] [-D]\n",
                    argv[0]);
            return 1;
        }
    }

    /* clamp */
    if (tdiv <= 0)
        tdiv = TEMP_DIV_DEFAULT;

    if (interval < INTERVAL_MIN)
        interval = INTERVAL_MIN;
    else if (interval > INTERVAL_MAX)
        interval = INTERVAL_MAX;

    if (temp_fail_limit < TEMP_FAIL_MIN)
        temp_fail_limit = TEMP_FAIL_DEFAULT;
    else if (temp_fail_limit > TEMP_FAIL_MAX)
        temp_fail_limit = TEMP_FAIL_MAX;

    if (access_pwm(ffile) != 0)
        auto_detect();

    if (status_mode)
        return print_status();

    if (access(ffile, W_OK) != 0) {
        fprintf(stderr, "fancontrol: no writable PWM device at %s\n", ffile);
        return 1;
    }
    if (access(tfile, R_OK) != 0) {
        set_fan_pwm(CURVE_MAX_PWM);
        fprintf(stderr, "fancontrol: no readable thermal zone; forcing PWM 255\n");
        return 1;
    }

    if (cs[0])
        parse_curve(cs);

    setup_signals();

    /* ---------- main loop ---------- */
    int last_speed = -1;
    int temp_failures = 0;
    int sensor_failed = 0;

    while (!stop_requested) {
        double cpu = 0.0;
        int temp_valid = cpu_temp(&cpu) == 0;

        if (temp_valid) {
            if (sensor_failed)
                fprintf(stderr, "fancontrol: temperature sensor recovered\n");
            temp_failures = 0;
            sensor_failed = 0;

            int sp = calc(cpu);
            if (sp != last_speed) {
                if (set_fan_pwm(sp) == 0)
                    last_speed = sp;
            }
        } else {
            if (temp_failures < temp_fail_limit)
                temp_failures++;

            if (temp_failures >= temp_fail_limit) {
                if (!sensor_failed)
                    fprintf(stderr,
                            "fancontrol: temperature sensor failed %d consecutive samples; forcing PWM 255\n",
                            temp_failures);
                sensor_failed = 1;
                if (set_fan_pwm(CURVE_MAX_PWM) == 0)
                    last_speed = CURVE_MAX_PWM;
            }
        }

        {
            int p = fan_pwm();
            write_status_file(temp_valid, cpu, p >= 0 ? p : last_speed);
        }

        if (debug) {
            if (temp_valid)
                fprintf(stdout, "CPU:%.1f Fan:%d Failures:%d\n", cpu, last_speed, temp_failures);
            else
                fprintf(stdout, "CPU:invalid Fan:%d Failures:%d\n", last_speed, temp_failures);
        }

        sleep((unsigned int)interval);
    }

    if (set_fan_pwm(CURVE_MAX_PWM) != 0) {
        fprintf(stderr, "fancontrol: unable to force PWM 255 while stopping\n");
        return 1;
    }

    return 0;
}
