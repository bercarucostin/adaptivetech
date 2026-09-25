// The editor's document model: every editing operation as a pure function, and a
// validator that mirrors public_price_document_is_valid.
//
// Two copies of the rules is a deliberate trade. The database one is the
// authority and cannot be bypassed; this one exists so an admin sees the problem
// next to the field that caused it instead of a failed publish. When the rules
// change, both change -- the bounds are listed in the spec.
(function (root) {
  'use strict';

  var MAX_ROWS = 200;
  var clone = function (doc) { return JSON.parse(JSON.stringify(doc)); };

  function emptyDocument() {
    return {
      schema: 1,
      currency: 'lei',
      intro_note: '',
      footnote: '',
      groups: [{ title: 'Grup nou', rows: [] }]
    };
  }

  function move(list, index, delta) {
    var target = index + delta;
    if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list;
    var copy = list.slice();
    var held = copy[index];
    copy[index] = copy[target];
    copy[target] = held;
    return copy;
  }

  function addGroup(doc) {
    var next = clone(doc);
    next.groups.push({ title: 'Grup nou', rows: [] });
    return next;
  }

  function removeGroup(doc, gi) {
    var next = clone(doc);
    next.groups.splice(gi, 1);
    return next;
  }

  function moveGroup(doc, gi, delta) {
    var next = clone(doc);
    next.groups = move(next.groups, gi, delta);
    return next;
  }

  function renameGroup(doc, gi, title) {
    var next = clone(doc);
    next.groups[gi].title = String(title);
    return next;
  }

  function addRow(doc, gi) {
    var next = clone(doc);
    next.groups[gi].rows.push({ item: '', amount: 0 });
    return next;
  }

  function removeRow(doc, gi, ri) {
    var next = clone(doc);
    next.groups[gi].rows.splice(ri, 1);
    return next;
  }

  function moveRow(doc, gi, ri, delta) {
    var next = clone(doc);
    next.groups[gi].rows = move(next.groups[gi].rows, ri, delta);
    return next;
  }

  // Amounts arrive from a text input, and a Romanian keyboard types a comma.
  function toAmount(value) {
    if (typeof value === 'number') return value;
    return Number(String(value).trim().replace(',', '.'));
  }

  function updateRow(doc, gi, ri, patch) {
    var next = clone(doc);
    var row = next.groups[gi].rows[ri];

    if ('item' in patch) row.item = String(patch.item);
    if ('amount' in patch) row.amount = toAmount(patch.amount);
    if ('footnote' in patch) {
      if (patch.footnote) row.footnote = true; else delete row.footnote;
    }
    // An empty optional field is absent, not an empty string: the renderer keys
    // off presence, and "" would print a stray dash.
    ['variant', 'currency'].forEach(function (field) {
      if (!(field in patch)) return;
      var text = String(patch[field] === null || patch[field] === undefined ? '' : patch[field]).trim();
      if (text) row[field] = text; else delete row[field];
    });

    return next;
  }

  function setField(doc, field, value) {
    var next = clone(doc);
    next[field] = field === 'currency' ? String(value).trim() : String(value);
    return next;
  }

  function validate(doc) {
    var errors = [];
    var titles = {};
    var rows = 0;
    var add = function (path, message) { errors.push({ path: path, message: message }); };
    var textWithin = function (value, min, max) {
      var length = value === null || value === undefined ? 0 : String(value).length;
      return length >= min && length <= max;
    };

    if (!doc || typeof doc !== 'object') { add('', 'Documentul lipsește.'); return errors; }
    if (doc.schema !== 1) add('schema', 'Versiune de document necunoscută.');
    if (!textWithin(doc.currency, 1, 8)) add('currency', 'Moneda este obligatorie (maximum 8 caractere).');
    if (!textWithin(doc.intro_note || '', 0, 400)) add('intro_note', 'Nota introductivă depășește 400 de caractere.');
    if (!textWithin(doc.footnote || '', 0, 400)) add('footnote', 'Nota de subsol depășește 400 de caractere.');

    if (!Array.isArray(doc.groups) || doc.groups.length === 0) {
      add('groups', 'Lista trebuie să aibă cel puțin un grup.');
      return errors;
    }

    doc.groups.forEach(function (group, gi) {
      if (!textWithin(group.title, 1, 80)) {
        add('groups.' + gi + '.title', 'Titlul grupului este obligatoriu (maximum 80 de caractere).');
      } else if (titles[group.title]) {
        add('groups.' + gi + '.title', 'Două grupuri nu pot avea același titlu.');
      } else {
        titles[group.title] = true;
      }

      if (!Array.isArray(group.rows)) {
        add('groups.' + gi + '.rows', 'Grupul este deteriorat.');
        return;
      }

      group.rows.forEach(function (row, ri) {
        var at = 'groups.' + gi + '.rows.' + ri;
        rows += 1;

        if (!textWithin(row.item, 1, 200)) add(at + '.item', 'Denumirea este obligatorie (maximum 200 de caractere).');
        if ('variant' in row && !textWithin(row.variant, 1, 60)) add(at + '.variant', 'Varianta poate avea maximum 60 de caractere.');
        if ('currency' in row && !textWithin(row.currency, 1, 8)) add(at + '.currency', 'Moneda poate avea maximum 8 caractere.');

        var amount = row.amount;
        if (typeof amount !== 'number' || !isFinite(amount)) {
          add(at + '.amount', 'Prețul trebuie să fie un număr.');
        } else if (amount < 0 || amount > 1000000) {
          add(at + '.amount', 'Prețul trebuie să fie între 0 și 1.000.000.');
        } else if (Math.round(amount * 100) !== amount * 100) {
          add(at + '.amount', 'Prețul poate avea cel mult două zecimale.');
        }
      });
    });

    if (rows > MAX_ROWS) add('groups', 'Lista poate avea cel mult ' + MAX_ROWS + ' de rânduri.');

    return errors;
  }

  var api = {
    emptyDocument: emptyDocument, validate: validate,
    addGroup: addGroup, removeGroup: removeGroup, moveGroup: moveGroup, renameGroup: renameGroup,
    addRow: addRow, removeRow: removeRow, moveRow: moveRow, updateRow: updateRow,
    setField: setField
  };
  root.PriceDocument = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
