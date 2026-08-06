#
# Copyright (C) 2008-2014 The LuCI Team <luci@lists.subsignal.org>
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-fancontrol
PKG_VERSION:=1.0
PKG_RELEASE:=15

LUCI_TITLE:=LuCI support for Fan Controller
LUCI_DEPENDS:=+luci-base +fancontrol
LUCI_PKGARCH:=all
LUCI_DESCRIPTION:=LuCI web interface for PWM fan speed control with temperature curve support.

ifneq ($(wildcard $(TOPDIR)/feeds/luci/luci.mk),)
include $(TOPDIR)/feeds/luci/luci.mk
# call BuildPackage - OpenWrt buildroot signature
else
include $(INCLUDE_DIR)/package.mk

define Package/luci-app-fancontrol
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=$(LUCI_TITLE)
  DEPENDS:=+luci-base +fancontrol
  PKGARCH:=all
endef

define Package/luci-app-fancontrol/description
  $(LUCI_DESCRIPTION)
endef

define Build/Compile
endef

define Package/luci-app-fancontrol/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/fancontrol.js \
		$(1)/www/luci-static/resources/view/fancontrol.js
	$(CP) ./root/* $(1)/
endef

$(eval $(call BuildPackage,luci-app-fancontrol))
endif
