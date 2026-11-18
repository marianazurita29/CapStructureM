(function () {
  "use strict";

  function weightedStats(rows, key) {
    if (rows[0][key] === null) return { mean: null, deviation: null };
    const mean = rows.reduce((sum, row) => sum + row.probability * row[key], 0);
    const variance = rows.reduce(
      (sum, row) => sum + row.probability * (row[key] - mean) ** 2, 0
    );
    return { mean, deviation: Math.sqrt(variance) };
  }

  function exampleFirm(scenarios, assets, debt, debtRate, taxRate) {
    const equity = assets - debt;
    const interest = debt * debtRate;
    const rows = scenarios.map(({ probability, sales, operating_costs: costs }) => {
      const ebit = sales - costs;
      const ebt = ebit - interest;
      const taxes = ebt * taxRate;
      const income = ebt - taxes;
      return {
        assets, equity, probability, sales, costs, ebit, interest, ebt, taxes,
        income, roe: income / equity, tie: interest === 0 ? null : ebit / interest
      };
    });
    const roe = weightedStats(rows, "roe");
    return { rows, roe, tie: weightedStats(rows, "tie"), cv: roe.mean === 0 ? null : roe.deviation / roe.mean };
  }

  function cdssAtDebt(cdss, rates, taxRate) {
    const { debt, cost_of_debt: debtRate, cost_of_equity: equityRate } = rates;
    const { total_assets: assets, shares_outstanding: shares, share_price: currentPrice } = cdss;
    const ebit = cdss.sales * (1 - cdss.variable_cost_rate) - cdss.fixed_costs;
    const interest = debt * debtRate;
    const income = (ebit - interest) * (1 - taxRate);
    const tie = interest === 0 ? null : ebit / interest;
    const equityValue = income / equityRate;
    const firmValue = equityValue + debt;

    const caseRepurchased = debt / currentPrice;
    const caseRemaining = shares - caseRepurchased;
    const caseEps = income / caseRemaining;
    const caseMethod = {
      debt, repurchased: caseRepurchased, remaining: caseRemaining, eps: caseEps, tie,
      price: caseEps / equityRate,
      wacc: debt / assets * debtRate * (1 - taxRate) + (assets - debt) / assets * equityRate
    };

    const newPrice = firmValue / shares;
    const newRepurchased = debt / newPrice;
    const newRemaining = shares - newRepurchased;
    const newPriceMethod = {
      debt, repurchased: newRepurchased, remaining: newRemaining, eps: income / newRemaining, tie,
      price: newPrice,
      wacc: debt / firmValue * debtRate * (1 - taxRate) + equityValue / firmValue * equityRate
    };
    return { caseMethod, newPriceMethod };
  }

  function roundHalfUp(value, digits) {
    const scale = 10 ** digits;
    return Math.round(Number((value * scale).toPrecision(12))) / scale;
  }

  const formulas = { exampleFirm, cdssAtDebt, roundHalfUp };
  if (typeof module === "object" && module.exports) module.exports = formulas;
  else window.capstruct = formulas;
})();
