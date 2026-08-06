#
# Hiveton H5000M's MT7987 eMMC/DDR4 boot ROM image.
# Keep this separate from the vendor-wide ATF package so that the complete
# upstream MediaTek target set remains available and unmodified.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=arm-trusted-firmware-mediatek-h5000m
PKG_RELEASE:=1

PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://github.com/mtk-openwrt/arm-trusted-firmware.git
PKG_SOURCE_DATE:=2025-07-11
PKG_SOURCE_VERSION:=78a0dfd927bb00ce973a1f8eb4079df0f755887a
PKG_MIRROR_HASH:=7b0710d8eed0204247d050607a24f07d9bc3a5191aa93c88479e3a49e8ec3116

PKG_MAINTAINER:=Daniel Golle <daniel@makrotopia.org>

include $(INCLUDE_DIR)/kernel.mk
include $(INCLUDE_DIR)/trusted-firmware-a.mk
include $(INCLUDE_DIR)/package.mk

define Trusted-Firmware-A/Default
  BUILD_TARGET:=mediatek
  TFA_IMAGE:=bl2.img bl31.bin
  HIDDEN:=y
  BOOT_DEVICE:=
  DDR4_4BG_MODE:=
  DDR4_FREQ_3200:=
endef

define Trusted-Firmware-A/mt7987-emmc-ddr4-4bg
  NAME:=MediaTek MT7987 (Hiveton H5000M eMMC, DDR4 4GB)
  BOOT_DEVICE:=emmc
  BUILD_SUBTARGET:=filogic
  BUILD_DEVICES:=hiveton-h5000m
  PLAT:=mt7987
  DDR4_4BG_MODE:=1
  DDR4_FREQ_3200:=1
endef

define Trusted-Firmware-A/mt7987-emmc-comb
  NAME:=MediaTek MT7987 (Hiveton H5000M 1G eMMC, combined DDR)
  BOOT_DEVICE:=emmc
  BUILD_SUBTARGET:=filogic
  BUILD_DEVICES:=hiveton-h5000m-1g
  PLAT:=mt7987
endef

TFA_TARGETS:=mt7987-emmc-comb

TFA_MAKE_FLAGS += \
	BOOT_DEVICE=$(BOOT_DEVICE) \
	USE_MKIMAGE=1 MKIMAGE=$(STAGING_DIR_HOST)/bin/mkimage \
	BOARD_BGA=1 \
	HAVE_DRAM_OBJ_FILE=yes \
	$(if $(DDR4_4BG_MODE),DDR4_4BG_MODE=1) \
	$(if $(DDR4_FREQ_3200),DDR4_FREQ_3200=1)

define Package/trusted-firmware-a/install
	$(INSTALL_DIR) $(STAGING_DIR_IMAGE)
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/build/$(PLAT)/release/bl2.img \
		$(STAGING_DIR_IMAGE)/$(BUILD_VARIANT)-bl2.img
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/build/$(PLAT)/release/bl31.bin \
		$(STAGING_DIR_IMAGE)/$(BUILD_VARIANT)-bl31.bin
endef

$(eval $(call BuildPackage/Trusted-Firmware-A))
