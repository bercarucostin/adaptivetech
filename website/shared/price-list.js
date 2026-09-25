// The one renderer for the public price list: the landing page loads it with a
// plain <script> tag, the admin panel's preview calls the same functions, so what
// an admin approves is what a visitor gets. Also require()-able from node --test.
//
// It returns a node tree and mounts that tree with createElement/createTextNode.
// There is deliberately no path in this file that builds an HTML string, so text
// an admin typed can never become markup on a public page.
(function (root) {
  'use strict';

  // 200 -> "200", 199.5 -> "199,5". The comma is written by hand: toLocaleString
  // depends on the runtime's ICU build, which would make tests pass or fail
  // according to how node was compiled.
  function formatAmount(amount) {
    return String(Math.round(Number(amount) * 100) / 100).replace('.', ',');
  }

  function el(tag, cls, children) { return { tag: tag, cls: cls, children: children || [] }; }
  function txt(value) { return { text: String(value) }; }

  function rowTree(row, listCurrency) {
    var item = [txt(row.item)];
    if (row.footnote) item.push(el('sup', 'ref', [txt('†')]));
    if (row.variant) { item.push(txt(' ')); item.push(el('span', 'variant', [txt('— ' + row.variant)])); }
    return el('li', 'row', [
      el('span', 'item', item),
      el('span', 'leader', []),
      el('span', 'price', [
        txt(formatAmount(row.amount)),
        el('span', 'cur', [txt(row.currency || listCurrency)])
      ])
    ]);
  }

  function priceListTree(doc) {
    var listCurrency = (doc && doc.currency) || 'lei';
    var nodes = [];
    if (doc && doc.intro_note) nodes.push(el('p', 'note-top', [txt(doc.intro_note)]));
    ((doc && doc.groups) || []).forEach(function (group) {
      nodes.push(el('div', 'group', [
        el('h3', null, [txt(group.title)]),
        el('ul', 'list', (group.rows || []).map(function (row) { return rowTree(row, listCurrency); }))
      ]));
    });
    if (doc && doc.footnote) {
      nodes.push(el('p', 'footnote', [el('sup', 'ref', [txt('†')]), txt(' ' + doc.footnote)]));
    }
    return nodes;
  }

  function build(node, d) {
    if (node.text !== undefined) return d.createTextNode(node.text);
    var element = d.createElement(node.tag);
    if (node.cls) element.className = node.cls;
    node.children.forEach(function (child) { element.appendChild(build(child, d)); });
    return element;
  }

  function mount(nodes, container, documentRef) {
    var d = documentRef || (typeof document !== 'undefined' ? document : null);
    while (container.firstChild) container.removeChild(container.firstChild);
    nodes.forEach(function (node) { container.appendChild(build(node, d)); });
  }

  var api = { priceListTree: priceListTree, mount: mount, formatAmount: formatAmount };
  root.PriceList = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
