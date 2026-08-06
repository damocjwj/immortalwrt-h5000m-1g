#
# Hiveton H5000M's MT7987 eMMC U-Boot target.
# The vendor-wide U-Boot source and patch stack remain intact in
# package/boot/uboot-mediatek; this package adds only the board target needed
# by the H5000M boot chain.
#

include $(TOPDIR)/rules.mk
include $(INCLUDE_DIR)/kernel.mk

PKG_NAME:=u-boot
PKG_VERSION:=2025.10
PKG_HASH:=b4f032848e56cc8f213ad59f9132c084dbbb632bc29176d024e58220e0efdf4a
PKG_BUILD_DEPENDS:=!(TARGET_ramips||TARGET_mediatek_mt7623):arm-trusted-firmware-tools/host

UBOOT_USE_INTREE_DTC:=1

include $(INCLUDE_DIR)/u-boot.mk
include $(INCLUDE_DIR)/package.mk
include $(INCLUDE_DIR)/host-build.mk

define U-Boot/Default
  BUILD_TARGET:=mediatek
  UBOOT_IMAGE:=u-boot-mtk.bin
  HIDDEN:=1
endef

define U-Boot/mt7987_hiveton_h5000m-emmc
  NAME:=Hiveton H5000M
  BUILD_SUBTARGET:=filogic
  BUILD_DEVICES:=hiveton-h5000m
  UBOOT_CONFIG:=mt7987a_hiveton_h5000m-emmc
  UBOOT_IMAGE:=u-boot.fip
  BL2_BOOTDEV:=emmc
  BL2_SOC:=mt7987
  BL2_DDRTYPE:=ddr4-4bg
  DEPENDS:=+trusted-firmware-a-mt7987-emmc-ddr4-4bg
endef

define U-Boot/mt7987_hiveton_h5000m-1g-emmc
  NAME:=Hiveton H5000M (1G/8G)
  BUILD_SUBTARGET:=filogic
  BUILD_DEVICES:=hiveton-h5000m-1g
  UBOOT_CONFIG:=mt7987a_hiveton_h5000m-1g-emmc
  UBOOT_IMAGE:=u-boot.fip
  BL2_BOOTDEV:=emmc
  BL2_SOC:=mt7987
  BL2_DDRTYPE:=comb
  DEPENDS:=+trusted-firmware-a-mt7987-emmc-comb
endef

UBOOT_TARGETS:=mt7987_hiveton_h5000m-1g-emmc

UBOOT_CUSTOMIZE_CONFIG:= \
	--disable TOOLS_KWBIMAGE \
	--disable TOOLS_LIBCRYPTO \
	--disable TOOLS_MKEFICAPSULE

ifdef CONFIG_TARGET_mediatek
UBOOT_MAKE_FLAGS += $(UBOOT_IMAGE:.fip=.bin)
endif

define Build/fip-image
	$(STAGING_DIR_HOST)/bin/fiptool create \
		--soc-fw $(STAGING_DIR_IMAGE)/$(BL2_SOC)-$(BL2_BOOTDEV)-$(BL2_DDRTYPE)-bl31.bin \
		--nt-fw $(PKG_BUILD_DIR)/u-boot.bin \
		$(PKG_BUILD_DIR)/u-boot.fip
endef

define Build/Configure
	$(call Build/Configure/U-Boot)
	sed -i 's/CONFIG_TOOLS_LIBCRYPTO=y/# CONFIG_TOOLS_LIBCRYPTO is not set/' \
		$(PKG_BUILD_DIR)/.config
endef

define Build/Compile
	$(call Build/Compile/U-Boot)
	$(call Build/fip-image)
endef

# Image recipes consume this FIP from STAGING_DIR_IMAGE.
define Package/u-boot/install
endef

define Build/InstallDev
	$(INSTALL_DIR) $(STAGING_DIR_IMAGE)
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/$(UBOOT_IMAGE) \
		$(STAGING_DIR_IMAGE)/$(BUILD_VARIANT)-$(UBOOT_IMAGE)
endef

$(eval $(call BuildPackage/U-Boot))
