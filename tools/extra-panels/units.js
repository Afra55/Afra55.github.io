(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    let unitCat;
    let unitFrom;
    let unitTo;
    let unitFromVal;
    let unitToVal;
    let unitHint;
  
    function fillUnitSelects() {
      if (!unitCat || !unitFrom || !unitTo || !unitFromVal || !unitToVal || !unitHint) return;
      const cat = unitCat.value;
      const table = P.UNIT_TABLES[cat];
      const units = cat === "temp" ? table.units : Object.keys(table.units);
      unitFrom.innerHTML = units.map((u) => `<option value="${u}">${u}</option>`).join("");
      unitTo.innerHTML = units.map((u) => `<option value="${u}">${u}</option>`).join("");
      if (cat === "length") {
        unitFrom.value = "m";
        unitTo.value = "cm";
      } else if (cat === "weight") {
        unitFrom.value = "kg";
        unitTo.value = "g";
      } else {
        unitFrom.value = "C";
        unitTo.value = "F";
      }
      convertUnits();
    }
  
    function convertUnits() {
      try {
        const out = P.convertUnit(unitCat.value, unitFromVal.value, unitFrom.value, unitTo.value);
        unitToVal.value = Number(out.toPrecision(12));
        unitHint.textContent = `${unitFromVal.value} ${unitFrom.value} = ${unitToVal.value} ${unitTo.value}`;
      } catch (err) {
        unitHint.textContent = err.message || String(err);
      }
    }
  
    bindPanel("units", () => {
        unitCat = $("#unit-cat");
        unitFrom = $("#unit-from");
        unitTo = $("#unit-to");
        unitFromVal = $("#unit-from-val");
        unitToVal = $("#unit-to-val");
        unitHint = $("#unit-hint");
  
        unitCat?.addEventListener("change", fillUnitSelects);
    [unitFrom, unitTo, unitFromVal].forEach((el) => el?.addEventListener("input", convertUnits));
    if (unitCat) fillUnitSelects();
  
    
    });

  window.DevToolsExtraBoot = window.DevToolsExtraBoot || {};
  window.DevToolsExtraBoot["units"] = () => { try { fillUnitSelects(); } catch (_) {} };
})();
