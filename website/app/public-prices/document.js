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
    // Use Object.create(null) to avoid prototype chain collisions: titles like
    // "constructor", "toString", or "__proto__" would otherwise be falsely flagged duplicates.
    var titles = Object.create(null);
    var rows = 0;
    // `fatal` marks a document the editor cannot even draw: renderGroups() reads
    // group.title and iterates group.rows, so a group that is not an object, or
    // rows that are not an array, throw there however carefully validate() reports
    // them. Ordinary errors -- a blank item name, a price with three decimals --
    // are not fatal: rendering them next to the offending field is the whole point
    // of validating in the browser. editor.js uses the flag to decide whether a
    // recovered draft is worth restoring at all.
    var add = function (path, message, fatal) {
      var error = { path: path, message: message };
      if (fatal) error.fatal = true;
      errors.push(error);
    };
    var textWithin = function (value, min, max) {
      var length = value === null || value === undefined ? 0 : String(value).length;
      return length >= min && length <= max;
    };

    if (!doc || typeof doc !== 'object') { add('', 'Documentul lipsește.', true); return errors; }
    if (doc.schema !== 1) add('schema', 'Versiune de document necunoscută.');

    if (typeof doc.currency !== 'string') {
      add('currency', 'Moneda trebuie să fie text.');
    } else if (!textWithin(doc.currency, 1, 8)) {
      add('currency', 'Moneda este obligatorie (maximum 8 caractere).');
    }

    if ('intro_note' in doc && doc.intro_note !== null && typeof doc.intro_note !== 'string') {
      add('intro_note', 'Nota introductivă trebuie să fie text.');
    } else if (!textWithin(doc.intro_note || '', 0, 400)) {
      add('intro_note', 'Nota introductivă depășește 400 de caractere.');
    }

    if ('footnote' in doc && doc.footnote !== null && typeof doc.footnote !== 'string') {
      add('footnote', 'Nota de subsol trebuie să fie text.');
    } else if (!textWithin(doc.footnote || '', 0, 400)) {
      add('footnote', 'Nota de subsol depășește 400 de caractere.');
    }

    if (!Array.isArray(doc.groups) || doc.groups.length === 0) {
      // Fatal only when groups is not an array: renderGroups() iterates it. An
      // empty array is invalid but perfectly renderable.
      add('groups', 'Lista trebuie să aibă cel puțin un grup.', !Array.isArray(doc.groups));
      return errors;
    }

    doc.groups.forEach(function (group, gi) {
      // A recovered draft can hold anything localStorage held. Reading
      // group.title off null throws, and a TypeError out of validate() takes the
      // editor down instead of showing the admin an error they can act on.
      if (!group || typeof group !== 'object' || Array.isArray(group)) {
        add('groups.' + gi, 'Grupul este deteriorat.', true);
        return;
      }

      if (typeof group.title !== 'string') {
        add('groups.' + gi + '.title', 'Titlul grupului trebuie să fie text.');
      } else if (!textWithin(group.title, 1, 80)) {
        add('groups.' + gi + '.title', 'Titlul grupului este obligatoriu (maximum 80 de caractere).');
      } else if (titles[group.title]) {
        add('groups.' + gi + '.title', 'Două grupuri nu pot avea același titlu.');
      } else {
        titles[group.title] = true;
      }

      if (!Array.isArray(group.rows)) {
        add('groups.' + gi + '.rows', 'Grupul este deteriorat.', true);
        return;
      }

      group.rows.forEach(function (row, ri) {
        var at = 'groups.' + gi + '.rows.' + ri;
        rows += 1;

        // Same reasoning as the group guard above: a corrupt row must report, not throw.
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          add(at, 'Rândul este deteriorat.', true);
          return;
        }

        if (typeof row.item !== 'string') {
          add(at + '.item', 'Denumirea trebuie să fie text.');
        } else if (!textWithin(row.item, 1, 200)) {
          add(at + '.item', 'Denumirea este obligatorie (maximum 200 de caractere).');
        }

        // The type gate before the length gate, as for currency, title and item:
        // textWithin() stringifies, so a number would pass a length check the SQL
        // validator rejects outright on jsonb_typeof.
        if ('variant' in row) {
          if (typeof row.variant !== 'string') add(at + '.variant', 'Varianta trebuie să fie text.');
          else if (!textWithin(row.variant, 1, 60)) add(at + '.variant', 'Varianta poate avea maximum 60 de caractere.');
        }

        if ('currency' in row) {
          if (typeof row.currency !== 'string') add(at + '.currency', 'Moneda rândului trebuie să fie text.');
          else if (!textWithin(row.currency, 1, 8)) add(at + '.currency', 'Moneda poate avea maximum 8 caractere.');
        }

        if ('footnote' in row && row.footnote !== true && row.footnote !== false && row.footnote !== null) {
          add(at + '.footnote', 'Nota rândului trebuie să fie adevărat, fals, sau absent.');
        }

        var amount = row.amount;
        if (typeof amount !== 'number' || !isFinite(amount)) {
          add(at + '.amount', 'Prețul trebuie să fie un număr.');
        } else if (amount < 0 || amount > 1000000) {
          add(at + '.amount', 'Prețul trebuie să fie între 0 și 1.000.000.');
        // Round to two decimals and compare against the original, rather than
        // testing `Math.round(amount * 100) !== amount * 100`. That older form
        // multiplies first, and the product of a legitimate two-decimal price
        // often lands a hair off an integer in binary floating point -- 32.05 *
        // 100 is 3204.9999999999995 -- so it falsely rejected 73,114 of the
        // 697,001 valid two-decimal values between 30.00 and 7000.00 and locked
        // the publish button on prices the database accepts. Dividing back keeps
        // both sides on the same scale: zero false rejections, and 0.005, 1.001,
        // 32.055 and 0.125 are still refused.
        } else if (Math.round(amount * 100) / 100 !== amount) {
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
