"use strict";

const { exampleFirm, cdssAtDebt, estimateRates, managementStake, bestDebtIndex, roundHalfUp } = window.capstruct;

async function loadCsv(file) {
  const response = await fetch(`data/${file}.csv`);
  if (!response.ok) throw new Error(`Could not load ${file}.csv (HTTP ${response.status}).`);
  return parseCsv(await response.text());
}

function parseCsv(content) {
  const [header, ...rows] = content.trim().split(/\r?\n/);
  const columns = header.split(",");
  // The case files use plain, comma-separated fields with no quoted commas.
  return rows.filter(row => row.trim()).map(row => {
    const fields = row.split(",");
    if (fields.length !== columns.length) throw new Error("A CSV row has the wrong number of fields.");
    return Object.fromEntries(columns.map((key, index) => [key, fields[index].trim()]));
  });
}

function numbersByKey(rows, key) {
  return Object.fromEntries(rows.map(row => [row[key], Number(row.value)]));
}

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0
});
const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const decimals = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});
const money = value => dollars.format(roundHalfUp(value, 0));
const price = value => cents.format(roundHalfUp(value, 2));
const number = value => decimals.format(roundHalfUp(value, 2));
const rate = value => value === null ? "n/a" : `${number(value * 100)}%`;
const multiple = value => value === null ? "n/a" : `${number(value)}×`;

function panel(title, note) {
  const element = document.createElement("div");
  element.className = "panel";
  const heading = document.createElement("h3");
  heading.textContent = title;
  element.append(heading);
  if (note) {
    const paragraph = document.createElement("p");
    paragraph.textContent = note;
    element.append(paragraph);
  }
  return element;
}

function renderTable(parent, title, headers, rows, schedule = false) {
  const table = document.createElement("table");
  if (schedule) {
    table.className = "schedule";
    table.setAttribute("role", "table");
  }
  const caption = table.createCaption();
  caption.className = "visually-hidden";
  caption.textContent = title;
  const header = table.createTHead().insertRow();
  for (const label of headers) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    header.append(cell);
  }
  const body = table.createTBody();
  for (const { values, highlights = [] } of rows) {
    const row = body.insertRow();
    if (schedule) row.setAttribute("role", "row");
    values.forEach((value, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      if (index === 0) cell.scope = "row";
      if (schedule) {
        cell.setAttribute("role", index === 0 ? "rowheader" : "cell");
        const label = document.createElement("span");
        label.textContent = headers[index];
        label.className = "cell-label";
        label.setAttribute("aria-hidden", "true");
        cell.append(label);
      }
      cell.append(document.createTextNode(value));
      if (highlights.includes(index)) cell.dataset.best = "";
      row.append(cell);
    });
  }
  parent.append(table);
}

function renderFirms(firms, taxRate) {
  const tables = document.querySelector("#firm-tables");
  tables.replaceChildren();
  const measures = [
    ["Assets", "assets", money], ["Equity", "equity", money],
    ["Probability", "probability", number], ["Sales", "sales", money],
    ["Operating costs", "costs", money], ["EBIT", "ebit", money],
    ["Interest", "interest", money], ["Earnings before tax", "ebt", money],
    [`Taxes (${rate(taxRate)})`, "taxes", money], ["Net income", "income", money],
    ["ROE", "roe", rate], ["TIE", "tie", multiple]
  ];
  for (const [name, firm] of firms) {
    const card = panel(name);
    const headers = ["Measure", ...firm.rows.map((_, index) => `Scenario ${index + 1}`)];
    const rows = measures.map(([label, key, format]) => ({
      values: [label, ...firm.rows.map(row => format(row[key]))]
    }));
    renderTable(card, `${name} income statements and ratios`, headers, rows);
    tables.append(card);
  }
  const summary = panel("Expected return and risk",
    "Expected values are probability-weighted averages. The coefficient of variation is the standard deviation divided by the expected return.");
  const entries = firms.map(([, firm]) => firm);
  const rows = [
    ["Expected ROE", ...entries.map(firm => rate(firm.roe.mean))],
    ["Standard deviation of ROE", ...entries.map(firm => rate(firm.roe.deviation))],
    ["Coefficient of variation of ROE", ...entries.map(firm => multiple(firm.cv))],
    ["Expected TIE", ...entries.map(firm => multiple(firm.tie.mean))],
    ["Standard deviation of TIE", ...entries.map(firm => multiple(firm.tie.deviation))]
  ];
  renderTable(summary, "Expected return and risk by firm", ["Measure", ...firms.map(([name]) => name)],
    rows.map(values => ({ values })));
  document.querySelector("#firm-summary").replaceChildren(summary);
}

function renderSchedule(title, note, rows) {
  const highestPrice = Math.max(...rows.map(row => row.price));
  const lowestWacc = Math.min(...rows.map(row => row.wacc));
  const debtsAt = (key, value) => rows.filter(row => row[key] === value).map(row => row.debt);
  const bestPriceDebt = debtsAt("price", highestPrice);
  const bestWaccDebt = debtsAt("wacc", lowestWacc);
  const card = panel(title, note);
  renderTable(card, title, ["Debt", "Shares repurchased", "Shares remaining", "EPS", "TIE", "Share price", "WACC"],
    rows.map(row => ({
      values: [money(row.debt), number(row.repurchased), number(row.remaining), price(row.eps),
        multiple(row.tie), price(row.price), rate(row.wacc)],
      highlights: [row.price === highestPrice ? 5 : -1, row.wacc === lowestWacc ? 6 : -1]
    })), true);
  const summary = document.createElement("p");
  summary.textContent = `Highest price at ${bestPriceDebt.map(money).join(" and ")} of debt. Lowest WACC at ${bestWaccDebt.map(money).join(" and ")} of debt.`;
  card.append(summary);
  document.querySelector("#cdss-tables").append(card);
  return [bestPriceDebt, bestWaccDebt];
}

function showDebt(input, output, debt) {
  const label = money(debt);
  input.setAttribute("aria-valuetext", label);
  output.value = label;
}

function setupFirmControl(outcomes, example, taxRate) {
  const { total_assets: assets, firm_l_debt: caseDebt, interest_rate: debtRate,
    slider_max: max, slider_step: step } = example;
  const input = document.querySelector("#firm-debt");
  const output = document.querySelector("#firm-debt-amount");
  input.max = max;
  input.step = step;
  input.value = caseDebt;
  document.querySelector("#firm-rate-note").textContent =
    `The interest rate stays at ${rate(debtRate)} to show how debt changes returns and risk at a fixed rate.`;
  const firmU = exampleFirm(outcomes, assets, 0, 0, taxRate);
  function update() {
    const debt = input.valueAsNumber;
    showDebt(input, output, debt);
    renderFirms([["Firm U", firmU], ["Firm L", exampleFirm(outcomes, assets, debt, debtRate, taxRate)]], taxRate);
  }
  input.addEventListener("input", update);
  document.querySelector("#firm-reset").addEventListener("click", () => {
    input.value = caseDebt;
    update();
  });
  update();
}

function renderSelectedCdss(cdss, { caseMethod, newPriceMethod }) {
  function stakeLabel(row) {
    const { stake, outsideLeft } = managementStake(cdss, row);
    if (stake === null) return "Management would have to sell shares.";
    return outsideLeft ? rate(stake) : `${rate(stake)} (no outside shareholders remain)`;
  }
  const card = panel("Selected debt results");
  const metrics = [
    ["Share price", row => price(row.price)],
    ["Shares repurchased", row => number(row.repurchased)],
    ["Shares remaining", row => number(row.remaining)],
    ["EPS", row => price(row.eps)],
    ["Dividends per share", row => price(row.eps)],
    ["TIE", row => multiple(row.tie)],
    ["WACC", row => rate(row.wacc)],
    ["Management's share", stakeLabel]
  ];
  renderTable(card, "CDSS buyback results at the selected debt",
    ["Measure", `Buy back at ${price(cdss.share_price)} (book WACC)`, "Buy back at new price (market WACC)"],
    metrics.map(([label, format]) => ({ values: [label, format(caseMethod), format(newPriceMethod)] })));
  document.querySelector("#cdss-selected").replaceChildren(card);
}

function setupCdssControl(cdss, taxRate) {
  const input = document.querySelector("#cdss-debt");
  const output = document.querySelector("#cdss-debt-amount");
  const note = document.querySelector("#selection-note");
  const mode = document.querySelector("#cdss-continuous");
  const modeNote = document.querySelector("#cdss-mode-note");
  const ratesText = document.querySelector("#cdss-rates");
  let continuous = false;
  let schedule, results;

  function selectedDebt() {
    return continuous ? input.valueAsNumber : schedule[input.valueAsNumber].debt;
  }

  function update() {
    const debt = selectedDebt();
    const exact = schedule.find(row => row.debt === debt);
    const rates = exact || estimateRates(schedule, debt);
    const source = exact ? "Banker's schedule" : "Estimated rates";
    const debtRate = debt === 0 ? "n/a" : rate(rates.cost_of_debt);
    ratesText.textContent = `${source} · Cost of debt ${debtRate} · Cost of equity ${rate(rates.cost_of_equity)}`;
    modeNote.textContent = continuous
      ? "Move by $1. Rates between bank quotes are estimated by linear interpolation. Below the first quote, the cost of debt uses that first rate. The buttons compare the banker's quoted amounts."
      : "The slider and buttons use the banker's quoted amounts.";
    showDebt(input, output, debt);
    renderSelectedCdss(cdss, cdssAtDebt(cdss, rates, taxRate));
  }

  mode.addEventListener("change", () => {
    const debt = selectedDebt();
    continuous = mode.checked;
    input.min = continuous ? schedule[0].debt : 0;
    input.max = continuous ? schedule.at(-1).debt : results.length - 1;
    const closest = schedule.reduce((best, row, index) =>
      Math.abs(row.debt - debt) < Math.abs(schedule[best].debt - debt) ? index : best, 0);
    input.value = continuous ? debt : closest;
    note.hidden = true;
    update();
  });
  input.addEventListener("input", () => {
    note.hidden = true;
    update();
  });
  for (const [id, metric] of [["best-price", "price"], ["highest-eps", "eps"]]) {
    document.getElementById(id).addEventListener("click", () => {
      const caseIndex = bestDebtIndex(results, "caseMethod", metric);
      const newIndex = bestDebtIndex(results, "newPriceMethod", metric);
      input.value = continuous ? schedule[caseIndex].debt : caseIndex;
      note.hidden = caseIndex === newIndex;
      note.textContent = `The case method selects ${money(results[caseIndex].caseMethod.debt)} and the new-price method selects ${money(results[newIndex].newPriceMethod.debt)}. The slider shows the case amount.`;
      update();
    });
  }
  return (nextSchedule, nextResults) => {
    schedule = nextSchedule;
    results = nextResults;
    input.min = 0;
    input.max = continuous ? schedule.at(-1).debt : schedule.length - 1;
    input.value = 0;
    note.hidden = true;
    update();
  };
}

function parseSchedule(rows) {
  if (rows.length < 2) throw new Error("Include a zero-debt row and at least one positive debt amount.");
  const schedule = rows.map(row => {
    const { debt, cost_of_debt: debtRate, cost_of_equity: equityRate } = row;
    if (!debt || debtRate === undefined || !equityRate || Object.keys(row).length !== 3) {
      throw new Error("Use the columns debt, cost_of_debt, and cost_of_equity.");
    }
    const amount = Number(debt);
    const rd = Number(debtRate);
    const rs = Number(equityRate);
    if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isFinite(rd) ||
        rd < 0 || rd > 1 || !Number.isFinite(rs) || rs <= 0 || rs > 1 ||
        (amount === 0 ? rd !== 0 : debtRate === "")) {
      throw new Error("Use nonnegative whole-dollar debt amounts and decimal rates (for example, 0.11).");
    }
    return { debt: amount, cost_of_debt: rd, cost_of_equity: rs };
  }).sort((a, b) => a.debt - b.debt);
  if (schedule[0].debt !== 0 || schedule.some((row, i) => i > 0 && row.debt === schedule[i - 1].debt)) {
    throw new Error("Include one zero-debt row and use each debt amount only once.");
  }
  return schedule;
}

function setupSchedulePicker(caseSchedule, showSchedule) {
  const input = document.querySelector("#banker-file");
  const status = document.querySelector("#banker-status");
  const reset = document.querySelector("#reset-banker");
  let activeReader;
  document.querySelector("#load-banker").addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const [file] = input.files;
    input.value = "";
    if (!file) return;
    activeReader?.abort();
    const reader = new FileReader();
    activeReader = reader;
    reader.addEventListener("load", () => {
      if (reader !== activeReader) return;
      try {
        showSchedule(parseSchedule(parseCsv(reader.result)));
        reset.hidden = false;
        status.textContent = `Using ${file.name}. This file was read on your device.`;
      } catch (error) {
        status.textContent = `${error.message} The current schedule is still active.`;
      }
    });
    reader.addEventListener("error", () => {
      if (reader === activeReader) status.textContent = "Could not read the file. The current schedule is still active.";
    });
    reader.readAsText(file);
  });
  reset.addEventListener("click", () => {
    activeReader?.abort();
    activeReader = undefined;
    showSchedule(caseSchedule);
    reset.hidden = true;
    status.textContent = "Using the AGE case schedule. Selected files stay on this device.";
  });
}

function renderCdssSchedules(cdss, results) {
  document.querySelector("#cdss-tables").replaceChildren();
  const caseRows = results.map(row => row.caseMethod);
  const best = [
    ...renderSchedule(`Case method · Buy back at ${price(cdss.share_price)}`,
      "WACC uses book values for debt and equity.", caseRows),
    ...renderSchedule("New-price method · Buy back at the post-announcement price",
      "WACC uses market values for debt and equity.", results.map(row => row.newPriceMethod))
  ];
  const methodsAgree = new Set(best.map(debts => debts.join(","))).size === 1;
  document.querySelector("#comparison").textContent = methodsAgree
    ? "Both methods identify the same borrowing amount for the highest share price and lowest WACC."
    : "The highest share price and lowest WACC do not all occur at the same debt level.";
  const baseline = caseRows.find(row => row.debt === 0);
  const warning = document.querySelector("#baseline-warning");
  warning.hidden = true;
  if (baseline && Math.abs(baseline.price - cdss.share_price) > 1e-8) {
    warning.textContent = `The model gives ${price(baseline.price)} at zero debt, but the case data lists ${price(cdss.share_price)}.`;
    warning.hidden = false;
  }
}

async function start() {
  const [assumptions, example, scenarios, company, bank] = await Promise.all(
    ["assumptions", "example_firms", "ebit_scenarios", "cdss", "banker_schedule"].map(loadCsv)
  );
  const { tax_rate: taxRate } = numbersByKey(assumptions, "assumption");
  const outcomes = scenarios.map(row => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value)])
  ));
  const cdss = numbersByKey(company, "item");
  const caseSchedule = parseSchedule(bank);
  setupFirmControl(outcomes, numbersByKey(example, "item"), taxRate);
  const showControl = setupCdssControl(cdss, taxRate);

  function showSchedule(schedule) {
    const results = schedule.map(row => cdssAtDebt(cdss, row, taxRate));
    if (results.some(({ caseMethod, newPriceMethod }) =>
      caseMethod.remaining <= 0 || newPriceMethod.remaining <= 0 || newPriceMethod.price <= 0 ||
      !Number.isFinite(newPriceMethod.eps) || !Number.isFinite(newPriceMethod.wacc))) {
      throw new Error("The schedule must leave shares outstanding and positive equity at every debt amount.");
    }
    renderCdssSchedules(cdss, results);
    showControl(schedule, results);
  }

  showSchedule(caseSchedule);
  setupSchedulePicker(caseSchedule, showSchedule);
  document.querySelector("#results").hidden = false;
  document.querySelector("#status").hidden = true;
}

start().catch(error => {
  document.querySelector("#status").textContent =
    `${error.message} Open the app through a web server so it can read the case files.`;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(error => {
    console.warn("Offline setup failed.", error);
  });
}
