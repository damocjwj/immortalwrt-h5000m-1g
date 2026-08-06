/* Copyright (C) 2022 ImmortalWrt.org */

'use strict';
'require dom';
'require form';
'require poll';
'require rpc';
'require uci';
'require view';

var getSystemFeatures = rpc.declare({
	object: 'luci.turboacc',
	method: 'getSystemFeatures',
	expect: { '': {} }
});

var getFastPathStat = rpc.declare({
	object: 'luci.turboacc',
	method: 'getFastPathStat',
	expect: { '': {} }
});

var getTCPCCAStat = rpc.declare({
	object: 'luci.turboacc',
	method: 'getTCPCCAStat',
	expect: { '': {} }
});

var getMTKPPEStat = rpc.declare({
	object: 'luci.turboacc',
	method: 'getMTKPPEStat',
	expect: { '': {} }
});

function valueOr(value, fallback) {
	value = value == null ? '' : String(value).replace(/^\s+|\s+$/g, '');

	return value || fallback;
}

function currentOption(option, fallback) {
	return valueOr(uci.get('turboacc', 'config', option), fallback);
}

function configuredEngine() {
	var engine = currentOption('fastpath', 'mediatek_hnat');

	return engine === 'mediatek_hnat' ? engine : 'none';
}

function availableCCA(features) {
	var values = valueOr(features.hasTCPCCA, 'cubic').split(/\s+/).filter(function(value) {
		return value !== '';
	});

	if (values.indexOf('cubic') < 0)
		values.push('cubic');

	return values.sort();
}

function getServiceStatus() {
	return Promise.all([
		L.resolveDefault(getFastPathStat(), {}),
		L.resolveDefault(getTCPCCAStat(), {})
	]);
}

function progressbar(value, max) {
	var current = parseInt(value, 10) || 0;
	var total = parseInt(max, 10) || 0;
	var percent = total > 0 ? Math.floor((100 / total) * current) : 0;

	percent = Math.max(0, Math.min(100, percent));

	return E('div', {
		'class': 'cbi-progressbar',
		'title': '%d / %d (%d%%)'.format(current, total, percent)
	}, E('div', { 'style': 'width: %d%%'.format(percent) }));
}

function statusNode(value) {
	var parts = valueOr(value, '').split(' / ').filter(function(part) {
		return part !== '';
	});
	var nodes = [];

	if (!parts.length)
		return E('em', {}, E('strong', { 'style': 'color: red' }, _('已禁用')));

	parts.forEach(function(part, index) {
		if (index)
			nodes.push(' / ');

		nodes.push(E('strong', {
			'style': 'color: ' + (index ? 'red' : 'green')
		}, part));
	});

	return E('em', {}, nodes);
}

function statusCell(id, value) {
	return E('td', { 'class': 'td left', 'id': id }, statusNode(value));
}

function ppeRows(ppe) {
	var count = parseInt(valueOr(ppe.PPE_NUM, '0'), 10) || 0;
	var rows = [];

	for (var index = 0; index < count; index++) {
		rows.push(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td left', 'width': '33%' }, 'PPE' + index + ' ' + _('已绑定连接数')),
			E('td', { 'class': 'td left' }, progressbar(ppe['BIND_PPE' + index], ppe['ALL_PPE' + index]))
		]));
	}

	return rows;
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('turboacc'),
			L.resolveDefault(getSystemFeatures(), {}),
			L.resolveDefault(getServiceStatus(), []),
			L.resolveDefault(getMTKPPEStat(), {})
		]);
	},

	render: function(data) {
		var features = data[1] || {};
		var initialStatus = data[2] || [];
		var initialPpe = data[3] || {};
		var m, s, o;

		m = new form.Map('turboacc', _('网络加速设置'));

		s = m.section(form.TypedSection);
		s.anonymous = true;
		s.render = function() {
			var ppeBody = E('tbody', { 'id': 'turboacc-ppe-status' }, ppeRows(initialPpe));
			var statusTable = E('table', { 'class': 'table' }, [
				E('tbody', {}, [
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'width': '33%' }, _('快速转发引擎')),
						statusCell('turboacc-fastpath-status', initialStatus[0] && initialStatus[0].type)
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'width': '33%' }, _('TCP 拥塞控制算法')),
						statusCell('turboacc-tcpcca-status', initialStatus[1] && initialStatus[1].type)
					])
				]),
				ppeBody
			]);

			poll.add(function() {
				return Promise.all([
					getServiceStatus(),
					L.resolveDefault(getMTKPPEStat(), {})
				]).then(function(nextData) {
					var status = nextData[0] || [];
					var cells = [
						['turboacc-fastpath-status', status[0] && status[0].type],
						['turboacc-tcpcca-status', status[1] && status[1].type]
					];

					cells.forEach(function(cell) {
						var node = document.getElementById(cell[0]);
						if (node)
							dom.content(node, statusNode(cell[1]));
					});

					var ppeNode = document.getElementById('turboacc-ppe-status');
					if (ppeNode)
						dom.content(ppeNode, ppeRows(nextData[1] || {}));
				});
			}, 3);

			return E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('加速状态')),
				statusTable
			]);
		};

		s = m.section(form.NamedSection, 'config', 'turboacc');
		s.addremove = false;

		o = s.option(form.ListValue, 'fastpath', _('快速转发引擎'),
			_('选择当前使用的加速方式。'));
		o.value('none', _('禁用'));
		o.value('mediatek_hnat', _('MediaTek HNAT'));
		o.default = configuredEngine();
		o.rmempty = false;
		o.cfgvalue = function(sectionId) {
			var engine = uci.get('turboacc', sectionId, 'fastpath');

			return engine === 'mediatek_hnat' ? engine : 'none';
		};

		o = s.option(form.Flag, 'fastpath_mh_eth_hnat', _('启用有线 HNAT'),
			_('启用 MediaTek HNAT hook_toggle；保存并应用后由 turboacc 服务写入内核开关。'));
		o.default = o.enabled;
		o.rmempty = false;
		o.depends('fastpath', 'mediatek_hnat');

		o = s.option(form.Flag, 'fastpath_mh_eth_hnat_v6', _('启用有线 IPv6 HNAT'),
			_('启用 IPv6 HNAT。'));
		o.default = o.enabled;
		o.rmempty = false;
		o.depends({ fastpath: 'mediatek_hnat', fastpath_mh_eth_hnat: '1' });

		o = s.option(form.Value, 'fastpath_mh_eth_hnat_bind_rate', _('HNAT 绑定速率阈值（pps）'),
			_('默认 30。'));
		o.datatype = 'range(1,30)';
		o.placeholder = '30';
		o.default = '30';
		o.rmempty = false;
		o.depends({ fastpath: 'mediatek_hnat', fastpath_mh_eth_hnat: '1' });

		o = s.option(form.ListValue, 'tcpcca', _('TCP 拥塞控制算法'),
			_('选择 TCP 拥塞控制算法。BBR 适合高带宽链路，CUBIC 为内核默认，Reno 兼容性最佳。'));
		availableCCA(features).forEach(function(cca) {
			o.value(cca, cca);
		});
		o.default = currentOption('tcpcca', 'cubic');
		o.rmempty = false;

		return m.render();
	}
});
