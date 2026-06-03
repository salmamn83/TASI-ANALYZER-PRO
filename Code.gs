// ============================================================
// أداة تحليل الأسهم السعودية - Google Apps Script
// ============================================================

const API_KEY = "YOUR_API_KEY";
const BASE_URL = "https://app.sahmk.sa/api/v1";

// ============================================================
// نقطة الدخول الرئيسية - تُستدعى من GitHub Pages
// ============================================================
function doGet(e) {
  const symbol   = e.parameter.symbol;
  const sectorPE = e.parameter.sector_pe ? parseFloat(e.parameter.sector_pe) : null;

  if (!symbol) {
    return buildResponse({ error: "يرجى إدخال رمز السهم" });
  }
  try {
    const result = analyzeStock(symbol, sectorPE);
    return buildResponse(result);
  } catch (err) {
    return buildResponse({ error: err.message });
  }
}

function buildResponse(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ============================================================
// الدالة الرئيسية للتحليل
// ============================================================
function analyzeStock(symbol, sectorPE) {
  // 1. جلب البيانات الخام من API
  const company    = fetchCompany(symbol);
  const quote      = fetchQuote(symbol);
  const financials = fetchFinancials(symbol);
  const dividends  = fetchDividends(symbol);
  const ratios     = fetchRatios(symbol);

  // 2. البيانات الأساسية - مبنية على schema التوثيق الرسمي
  const price            = quote.price || 0;
  const sharesOut        = company.fundamentals?.shares_outstanding || 0;
  const marketCap        = company.fundamentals?.market_cap || 0;
  const bookValue        = company.fundamentals?.book_value || 0;
  const analystConsensus = company.analysts?.consensus || "";
  const analystTarget    = company.analysts?.target_mean || 0;
  const analystLow       = company.analysts?.target_low || 0;
  const analystHigh      = company.analysts?.target_high || 0;
  const description      = company.description || "";
  const sectorName       = company.sector || "";
  const dividendYield    = dividends.trailing_12m_yield || company.fundamentals?.dividend_yield || 0;
  const fairPriceSahmk   = company.valuation?.fair_price || null;

  // sectorPE يأتي من GitHub Pages (جلبه المتصفح من تداول)
  // إذا لم يُرسل نتركه null ويُعوَّض بالمكرر المحايد في القيمة العادلة
  const resolvedSectorPE = (sectorPE && !isNaN(sectorPE) && sectorPE > 0) ? sectorPE : null;

  // 3. الحسابات
  const epsData        = calcEPS(financials, sharesOut);
  const epsTTM         = epsData.ttm;
  const peTTM          = epsTTM > 0 ? roundTo(price / epsTTM, 2) : null;
  const peComparison   = calcPEComparison(peTTM, resolvedSectorPE);
  const fcfData        = calcFCF(financials);
  const dividendHistory = getDividendHistory(dividends);
  const payoutRatio    = calcPayoutRatio(financials, dividendHistory, sharesOut);
  const stockCategory  = calcStockCategory(payoutRatio);
  const fairValue      = calcFairValue(price, epsTTM, epsData, fcfData, dividendHistory, sharesOut, marketCap, fairPriceSahmk, resolvedSectorPE);
  const futurePrice    = calcFuturePrice(peTTM, financials, sharesOut);
  const payoutVerdict  = calcPayoutVerdict(payoutRatio);
  const quarterlyData  = calcQuarterlyAnalysis(financials);
  const annualData     = calcAnnualAnalysis(financials, sharesOut);
  const scoreData      = calcInvestmentScore(fairValue.value, price, analystConsensus, quarterlyData, annualData, fcfData);

  // 4. تجميع النتيجة النهائية
  return {
    // القسم 1
    section1: {
      companyName:       company.name || company.name_en || symbol,
      sector:            sectorName,
      symbol:            symbol,
      stockCategory:     stockCategory,
      marketCap:         marketCap,
      bookValuePerShare: bookValue,
      peTTM:             peTTM,
      analystConsensus:  analystConsensus,
      analystTarget:     analystTarget,
      description:       description
    },
    // القسم 2
    section2: {
      price:             price,
      peTTM:             peTTM,
      sectorPE:          resolvedSectorPE,
      peComparison:      peComparison,
      fairValue:         fairValue.value,
      fairValueVerdict:  fairValue.verdict,
      fairValueDetail:   fairValue.detail,
      analystLow:        analystLow,
      analystHigh:       analystHigh,
      futurePrice:       futurePrice,
      dividendYield:     dividendYield,
      payoutRatio:       payoutRatio,
      payoutVerdict:     payoutVerdict
    },
    // القسم 3
    section3: quarterlyData,
    // القسم 4
    section4: annualData,
    // القسم 5
    section5: buildVerdict(scoreData, stockCategory, fairValue, analystConsensus, quarterlyData, annualData)
  };
}

// ============================================================
// جلب البيانات من API سهمك
// ============================================================
function fetchCompany(symbol) {
  // Free: name/sector/description | Starter: +fundamentals | Pro: +technicals/valuation/analysts
  return fetchJSON(`${BASE_URL}/company/${symbol}/`);
}

function fetchQuote(symbol) {
  // Free - سعر السهم الحالي
  return fetchJSON(`${BASE_URL}/quote/${symbol}/`);
}

function fetchFinancials(symbol) {
  return fetchJSON(`${BASE_URL}/financials/${symbol}/?period=quarterly&history=5y&metrics=extended&type=all`);
}

function fetchFinancialsAnnual(symbol) {
  // القوائم المالية السنوية فقط
  return fetchJSON(`${BASE_URL}/financials/${symbol}/?period=annual&history=3y&metrics=extended&type=all`);
}

function fetchRatios(symbol) {
  // Starter+ - النسب المالية
  return fetchJSON(`${BASE_URL}/analytics/ratios/${symbol}/`);
}

function fetchSectors() {
  // Free - أداء القطاعات
  return fetchJSON(`${BASE_URL}/market/sectors/?index=TASI`);
}

function fetchDividends(symbol) {
  // Starter+ - تاريخ التوزيعات
  return fetchJSON(`${BASE_URL}/dividends/${symbol}/`);
}

function fetchJSON(url) {
  const options = {
    method: "get",
    headers: { "X-API-Key": API_KEY },
    muteHttpExceptions: true
  };
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if (code !== 200) throw new Error(`خطأ في API: ${code} | ${url}`);
  return JSON.parse(response.getContentText());
}


// ============================================================
// دوال مساعدة لاستخراج البيانات من schema سهمك
// ============================================================
function getQuarterlyStatements(financials) {
  const sortDesc = (a, b) => new Date(b.report_date) - new Date(a.report_date);

  function calcQ4(rows, fields) {
    const byYear = {};
    rows.forEach(q => {
      if (!byYear[q.fiscal_year]) byYear[q.fiscal_year] = [];
      byYear[q.fiscal_year].push(q);
    });

    const result = [];
    Object.values(byYear).forEach(yearRows => {
      const q1 = yearRows.find(q => q.fiscal_quarter === 1);
      const q2 = yearRows.find(q => q.fiscal_quarter === 2);
      const q3 = yearRows.find(q => q.fiscal_quarter === 3);
      const q4annual = yearRows.find(q => q.fiscal_quarter === 4);

      // أضف Q1 Q2 Q3 كما هي
      [q1, q2, q3].forEach(q => { if (q) result.push(q); });

      // Q4 الحقيقي = السنوي - Q1 - Q2 - Q3
      if (q4annual && q1 && q2 && q3) {
        const fixedQ4 = { ...q4annual };
        fields.forEach(f => {
          fixedQ4[f] = roundTo(
            (q4annual[f] || 0) - (q1[f] || 0) - (q2[f] || 0) - (q3[f] || 0), 2
          );
        });
        result.push(fixedQ4);
      }
    });

    return result.sort(sortDesc);
  }

  const incFields = ["total_revenue", "gross_profit", "operating_income", "net_income"];
  const cfFields  = ["operating_cash_flow", "net_cash_operating", "capital_expenditures", "capex", "free_cash_flow"];

  const income   = calcQ4(financials.income_statements || [], incFields);
  const cashflow = calcQ4(financials.cash_flows || [], cfFields);
  // الميزانية snapshot وليست تراكمية
  const balance  = (financials.balance_sheets || []).sort(sortDesc);

  return { income, balance, cashflow };
}

function getAnnualStatements(financials) {
  const sortDesc = (a, b) => new Date(b.report_date) - new Date(a.report_date);

  // السنوي: نأخذ Q4 التراكمي مباشرة لأنه يمثل الكامل السنوي
  const income   = (financials.income_statements || [])
    .filter(q => q.fiscal_quarter === 4 || q.statement_period === "annual")
    .sort(sortDesc);
  const balance  = (financials.balance_sheets || [])
    .filter(q => q.fiscal_quarter === 4 || q.statement_period === "annual")
    .sort(sortDesc);
  const cashflow = (financials.cash_flows || [])
    .filter(q => q.fiscal_quarter === 4 || q.statement_period === "annual")
    .sort(sortDesc);

  return { income, balance, cashflow };
}

function getQuarterLabel(q) {
  return "Q" + q.fiscal_quarter + " " + q.fiscal_year;
}

// ============================================================
// حساب EPS من آخر 4 أرباع فعلية (بدون API)
// ============================================================
function calcEPS(financials, sharesOut) {
  if (!sharesOut || sharesOut === 0) return { ttm: 0, quarters: [], prevTTM: null };

  const { income } = getQuarterlyStatements(financials);
  const last4 = income.slice(0, 4);
  const prev4 = income.slice(4, 8);

  const epsQuarters = last4.map(q => ({
    label:     getQuarterLabel(q),
    netIncome: q.net_income || 0,
    eps:       roundTo((q.net_income || 0) / sharesOut, 4)
  }));

  const epsTTM = roundTo(
    epsQuarters.reduce((sum, q) => sum + q.eps, 0), 4
  );

  const prevEpsTTM = prev4.length === 4
    ? roundTo(prev4.reduce((sum, q) => sum + (q.net_income || 0) / sharesOut, 0), 4)
    : null;

  return { ttm: epsTTM, quarters: epsQuarters, prevTTM: prevEpsTTM };
}

// ============================================================
// حساب FCF = التدفق التشغيلي - CapEx
// ============================================================
function calcFCF(financials) {
  const annualQ    = getAnnualStatements(financials);
  const quarterlyQ = getQuarterlyStatements(financials);

  // FCF السنوي - استخدام free_cash_flow مباشرة إن وُجد
  const annualFCF = annualQ.cashflow.slice(0, 2).map(cf => ({
    year:  cf.fiscal_year,
    value: roundTo(cf.free_cash_flow || (cf.operating_cash_flow || 0) - (cf.capital_expenditures || 0), 2)
  }));

  // FCF TTM = مجموع آخر 4 أرباع
  const last4Q = quarterlyQ.cashflow.slice(0, 4);
  const fcfTTM = roundTo(
    last4Q.reduce((sum, q) =>
      sum + (q.free_cash_flow || (q.operating_cash_flow || 0) - (q.capital_expenditures || 0)), 0), 2
  );

  return {
    ttm:        fcfTTM,
    annual:     annualFCF,
    isPositive: fcfTTM > 0
  };
}

// ============================================================
// حساب نسبة التوزيع
// ============================================================
function calcPayoutRatio(financials, dividendHistory, sharesOut) {
  const { income } = getAnnualStatements(financials);
  if (!income.length || !dividendHistory.length || !sharesOut) return 0;
  const netIncome = income[0].net_income || 0;
  if (netIncome <= 0) return 0;
  // التوزيع للسهم × عدد الأسهم = إجمالي التوزيعات السنوية (آخر 4 أرباع)
  const divPerShare = dividendHistory.slice(0, 4).reduce((s, d) => s + (d.amount || 0), 0);
  const totalDiv = divPerShare * sharesOut;
  return roundTo((totalDiv / netIncome) * 100, 2);
}

// ============================================================
// فئة السهم: نمو أو توزيعات
// ============================================================
function calcStockCategory(payoutRatio) {
  return payoutRatio >= 60 ? "توزيعات" : "نمو";
}

// ============================================================
// حكم نسبة التوزيع
// ============================================================
function calcPayoutVerdict(payoutRatio) {
  if (payoutRatio === 0)   return "لا توزيعات";
  if (payoutRatio < 75)    return "مستدام";
  if (payoutRatio <= 90)   return "يستحق المراقبة";
  return "حرج";
}


// ============================================================
// جلب مكرر القطاع من موقع تداول الرسمي
// ============================================================
function fetchSectorPEFromTadawul(sectorName) {
  try {
    const url = "https://www.saudiexchange.sa/Resources/Reports-v2/DailyFinancialIndicators_en.html";
    const options = { method: "get", muteHttpExceptions: true };
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() !== 200) return null;

    const html = response.getContentText();

    // البحث عن سطر القطاع في الجدول
    // كل سطر قطاع يبدأ باسم القطاع بدون رمز سهم
    // مثال: | Energy | | 245,826.913 | ... | 17.882 | ...
    const sectorMap = {
      "Energy":                        "Energy",
      "Materials":                     "Materials",
      "Banks":                         "Banks",
      "Diversified Financials":        "Diversified Financials",
      "Insurance":                     "Insurance",
      "Telecommunication Services":    "Telecommunication Services",
      "Utilities":                     "Utilities",
      "Capital Goods":                 "Capital Goods",
      "Commercial & Professional Svc": "Commercial & Professional Svc",
      "Retailing":                     "Retailing",
      "Consumer Durables & Apparel":   "Consumer Durables & Apparel",
      "Food & Beverages":              "Food & Beverages",
      "Food & Staples Retailing":      "Food & Staples Retailing",
      "Health Care Equipment & Svc":   "Health Care Equipment & Svc",
      "PharmaBiotech & Life Science":  "PharmaBiotech & Life Science",
      "Software & Services":           "Software & Services",
      "Media":                         "Media",
      "Real Estate Mgmt & Development":"Real Estate Mgmt & Development",
      "Real Estate Investment Trust":  "Real Estate Investment Trust",
      "Consumer Services":             "Consumer Services"
    };

    const targetSector = sectorMap[sectorName] || sectorName;

    // استخراج الصفوف من الجدول
    // نبحث عن سطر يحتوي على اسم القطاع كاملاً بدون رمز رقمي
    const rows = html.split("<tr");
    for (const row of rows) {
      // سطر القطاع: العمود الأول يحتوي على اسم القطاع والثاني فارغ
      if (row.indexOf(targetSector) === -1) continue;

      // استخراج الخلايا
      const cells = [];
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let match;
      while ((match = cellRegex.exec(row)) !== null) {
        const val = match[1].replace(/<[^>]+>/g, "").replace(/,/g, "").trim();
        cells.push(val);
      }

      // تأكد أن هذا سطر القطاع (الخلية الأولى = اسم القطاع)
      if (cells.length >= 9 && cells[0] === targetSector) {
        // عمود P/E Ratio هو التاسع (index 8) بناءً على بنية الجدول
        const peVal = parseFloat(cells[8]);
        if (!isNaN(peVal) && peVal > 0) return peVal;
      }
    }
    return null;
  } catch(e) {
    Logger.log("خطأ في جلب مكرر القطاع: " + e.message);
    return null;
  }
}

function getSectorPE(sectorName) {
  return fetchSectorPEFromTadawul(sectorName);
}



function calcPEComparison(peTTM, sectorPE) {
  if (!peTTM || !sectorPE) return { text: "غير متاح", diff: null };
  const diff = roundTo(((peTTM - sectorPE) / sectorPE) * 100, 1);
  let text;
  if (diff < -15)      text = "أرخص بشكل ملحوظ من المنافسين";
  else if (diff <= 15) text = "متوافق مع القطاع";
  else                 text = "أغلى من المنافسين";
  return { text, diff, sectorPE };
}

// ============================================================
// تاريخ التوزيعات
// ============================================================
function getDividendHistory(dividends) {
  const items = dividends?.history || dividends?.dividends || dividends?.data || [];
  return items
    .filter(d => (d.value || d.amount || 0) > 0)
    .map(d => ({
      year:   parseInt(d.fiscal_year) || new Date(d.announcement_date || Date.now()).getFullYear(),
      period: d.period || "",
      amount: d.value || d.amount || 0
    }));
}

// ============================================================
// القيمة العادلة - 4 طرق مع أوزان وضوابط
// ============================================================
function calcFairValue(price, epsTTM, epsData, fcfData, dividendHistory, sharesOut, marketCap, fairPriceSahmk, sectorPE) {
  const r   = 0.10; // معدل الخصم
  const gInf = 0.03; // معدل النمو الأبدي

  // تحديد حجم الشركة والأوزان الأساسية
  const weights = getWeightsBySize(marketCap);

  const methods = {};
  const neutralPE = (epsData.prevTTM && epsTTM > epsData.prevTTM) ? 20 : 15;

  // --- الطريقة 1: DCF ---
  if (fcfData.ttm > 0 && sharesOut > 0) {
    const fcfGrowth = calcFCFGrowthRate(fcfData);
    const g = Math.min(Math.max(fcfGrowth, 0), 0.30);
    let totalPV = 0;
    let fcf = fcfData.ttm;
    for (let n = 1; n <= 5; n++) {
      fcf = fcf * (1 + g);
      totalPV += fcf / Math.pow(1 + r, n);
    }
    const terminalValue = (fcf * (1 + gInf)) / (r - gInf);
    totalPV += terminalValue / Math.pow(1 + r, 5);
    methods.dcf = roundTo(totalPV / sharesOut, 2);
  } else {
    methods.dcf = null; // FCF سالب → استبعاد
  }

  // --- الطريقة 2: DDM ---
  if (dividendHistory.length >= 3 && sharesOut > 0) {
    const divGrowth = calcDividendGrowthRate(dividendHistory);
    const g = Math.min(divGrowth, 0.09);
    const d = dividendHistory[0].amount / sharesOut;
    methods.ddm = roundTo((d * (1 + g)) / (r - g), 2);
  } else {
    methods.ddm = null; // أقل من 3 توزيعات → استبعاد
  }

  // --- الطريقة 3: تقييم سهمك ---
  methods.sahmk = fairPriceSahmk || null;

  // --- الطريقة 4: مكرر القطاع ---
  if (sectorPE && epsTTM > 0) {
    methods.sectorPE = roundTo(sectorPE * epsTTM, 2);
  } else {
    methods.sectorPE = null;
  }

  // --- تطبيق الضوابط: استبعاد الشاذ ---
  const activeValues = Object.entries(methods)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => ({ key: k, value: v }));

  if (!activeValues.length) return { value: null, verdict: "غير متاح", detail: {} };

  // حساب المتوسط الأولي للكشف عن الشاذ
  const avg = activeValues.reduce((s, m) => s + m.value, 0) / activeValues.length;
  const finalMethods = activeValues.map(m => {
    const ratio = m.value / avg;
    if (ratio < 0.5 || ratio > 2.0) {
      // شاذ → استبدال بالمكرر المحايد
      return { key: m.key, value: roundTo(neutralPE * epsTTM, 2), replaced: true };
    }
    return { ...m, replaced: false };
  });

  // إعادة توزيع الأوزان على الطرق الفعلية المتاحة
  const finalWeights = redistributeWeights(weights, methods);

  // حساب القيمة العادلة النهائية
  let fairValue = 0;
  const detail = {};
  finalMethods.forEach(m => {
    const w = finalWeights[m.key] || 0;
    fairValue += m.value * w;
    detail[m.key] = { value: m.value, weight: roundTo(w * 100, 1), replaced: m.replaced };
  });

  fairValue = roundTo(fairValue, 2);

  // حكم القيمة العادلة
  const diffPct = ((fairValue - price) / fairValue) * 100;
  let verdict;
  if (diffPct > 10)       verdict = "مقوم بأقل من قيمته";
  else if (diffPct >= -10) verdict = "يتداول بالقيمة العادلة";
  else                     verdict = "مبالغ في تقييمه";

  return { value: fairValue, verdict, detail };
}

function getWeightsBySize(marketCap) {
  const b = 1e9;
  if (marketCap > 50 * b)      return { dcf: 0.40, ddm: 0.30, sahmk: 0.20, sectorPE: 0.10 };
  if (marketCap > 10 * b)      return { dcf: 0.35, ddm: 0.20, sahmk: 0.25, sectorPE: 0.20 };
  if (marketCap > 1 * b)       return { dcf: 0.30, ddm: 0.15, sahmk: 0.25, sectorPE: 0.30 };
  return                              { dcf: 0.25, ddm: 0.10, sahmk: 0.25, sectorPE: 0.40 };
}

function redistributeWeights(weights, methods) {
  const excluded = Object.keys(methods).filter(k => methods[k] === null);
  if (!excluded.length) return weights;

  const available = Object.keys(weights).filter(k => !excluded.includes(k));
  const totalExcluded = excluded.reduce((s, k) => s + (weights[k] || 0), 0);
  const redistrib = totalExcluded / available.length;

  const newWeights = { ...weights };
  excluded.forEach(k => { newWeights[k] = 0; });
  available.forEach(k => { newWeights[k] = roundTo(newWeights[k] + redistrib, 4); });
  return newWeights;
}

function calcFCFGrowthRate(fcfData) {
  if (!fcfData.annual || fcfData.annual.length < 2) return 0.05;
  const latest = fcfData.annual[0].value;
  const prev   = fcfData.annual[1].value;
  if (!prev || prev <= 0) return 0.05;
  return (latest - prev) / prev;
}

function calcDividendGrowthRate(history) {
  if (history.length < 2) return 0.03;
  const rates = [];
  for (let i = 0; i < history.length - 1; i++) {
    const curr = history[i].amount;
    const prev = history[i + 1].amount;
    if (prev > 0) rates.push((curr - prev) / prev);
  }
  return rates.length ? rates.reduce((s, r) => s + r, 0) / rates.length : 0.03;
}

// ============================================================
// السعر المستقبلي - 3 سيناريوهات
// ============================================================
function calcFuturePrice(peTTM, financials, sharesOut) {
  if (!peTTM || !sharesOut) return null;

  const { income } = getQuarterlyStatements(financials);
  if (income.length < 4) return null;

  // آخر 3 أرباع فعلية
  const q0 = income[0]; // الربع الحالي
  const q1 = income[1]; // Q-1
  const q2 = income[2]; // Q-2

  // الربع القادم المفترض = الربع المقابل من السنة الماضية (Q-3 = نفس الربع من السنة السابقة)
  const q3estimated = income.find(q =>
    q.fiscal_quarter === q0.fiscal_quarter &&
    q.fiscal_year === q0.fiscal_year - 1
  ) || income[3];

  if (!q3estimated) return null;

  // EPS المستقبلي = مجموع الأرباع الأربعة ÷ عدد الأسهم
  const futureNetIncome = (q0.net_income || 0) + (q1.net_income || 0) +
                          (q2.net_income || 0) + (q3estimated.net_income || 0);
  const futureEPS = roundTo(futureNetIncome / sharesOut, 4);

  if (futureEPS <= 0) return null;

  return {
    base:    roundTo(peTTM * futureEPS, 2),
    grow10:  roundTo(peTTM * futureEPS * 1.10, 2),
    grow20:  roundTo(peTTM * futureEPS * 1.20, 2),
    futureEPS: futureEPS
  };
}

// ============================================================
// التحليل الربع سنوي - القسم 3
// ============================================================
function calcQuarterlyAnalysis(financials) {
  const { income: inc, cashflow: cf } = getQuarterlyStatements(financials);

  if (inc.length < 2) return { rows: [] };

  const q0 = inc[0];
  const q1 = inc[1];
  const q4 = inc.find(q => q.fiscal_quarter === q0.fiscal_quarter && q.fiscal_year === q0.fiscal_year - 1) || inc[4] || inc[inc.length - 1];

  const cf0 = cf[0] || {};
  const cf1 = cf[1] || {};
  const cf4 = cf.find(q => q.fiscal_quarter === q0?.fiscal_quarter && q.fiscal_year === q0?.fiscal_year - 1) || cf[4] || {};

  const labels = {
    current:  getQuarterLabel(q0),
    previous: getQuarterLabel(q1),
    similar:  q4 ? getQuarterLabel(q4) : "—"
  };

  // البنود الأساسية دائماً موجودة
  const baseRows = [
    {
      name:     "الإيرادات",
      current:  q0.total_revenue || 0,
      previous: q1.total_revenue || 0,
      similar:  q4?.total_revenue || 0
    },
    {
      name:     "صافي الدخل",
      current:  q0.net_income || 0,
      previous: q1.net_income || 0,
      similar:  q4?.net_income || 0
    }
  ];

  // التدفقات فقط إذا كانت القيم غير null
  const hasOperating = cf0.operating_cash_flow != null;
  const hasFCF       = cf0.free_cash_flow != null;

  if (hasOperating) {
    baseRows.push({
      name:     "التدفق التشغيلي",
      current:  cf0.operating_cash_flow || 0,
      previous: cf1.operating_cash_flow != null ? cf1.operating_cash_flow : null,
      similar:  cf4?.operating_cash_flow != null ? cf4.operating_cash_flow : null
    });
  }

  if (hasFCF) {
    baseRows.push({
      name:     "التدفق النقدي الحر",
      current:  cf0.free_cash_flow || 0,
      previous: cf1.free_cash_flow != null ? cf1.free_cash_flow : null,
      similar:  cf4?.free_cash_flow != null ? cf4.free_cash_flow : null
    });
  }

  const rows = baseRows.map(row => {
    const qoq = row.previous != null ? calcGrowthPct(row.current, row.previous) : null;
    const yoy = row.similar  != null ? calcGrowthPct(row.current, row.similar)  : null;
    return { ...row, qoq, yoy, analysis: getQuarterlyAnalysisText(qoq, yoy) };
  });

  return { labels, rows };
}

function calcGrowthPct(current, base) {
  if (!base || base === 0) return null;
  return roundTo(((current - base) / Math.abs(base)) * 100, 1);
}

function getQuarterlyAnalysisText(qoq, yoy) {
  if (qoq === null) return "—";
  if (qoq > 5)        return "زخم صاعد قوي";
  if (qoq > 0)        return "زخم صاعد";
  if (qoq > -5)       return "تراجع طفيف";
  return "تراجع ملحوظ";
}

// ============================================================
// التحليل السنوي - القسم 4
// ============================================================
function calcAnnualAnalysis(financials, sharesOut) {
  const { income: inc, balance: bal, cashflow: cf } = getAnnualStatements(financials);
  if (inc.length < 2) return { profitability: [], leverage: [] };

  const y0inc = inc[0]; const y1inc = inc[1];
  const y0bal = bal[0] || {}; const y1bal = bal[1] || {};
  const y0cf  = cf[0]  || {}; const y1cf  = cf[1]  || {};

  // هامش صافي الربح
  const margin0 = y0inc.total_revenue > 0 ? roundTo((y0inc.net_income / y0inc.total_revenue) * 100, 2) : 0;
  const margin1 = y1inc.total_revenue > 0 ? roundTo((y1inc.net_income / y1inc.total_revenue) * 100, 2) : 0;

  // ROE
  const roe0 = y0bal.stockholders_equity > 0 ? roundTo((y0inc.net_income / y0bal.stockholders_equity) * 100, 2) : 0;
  const roe1 = y1bal.stockholders_equity > 0 ? roundTo((y1inc.net_income / y1bal.stockholders_equity) * 100, 2) : 0;

  // FCF
  const fcf0 = roundTo(y0cf.free_cash_flow || (y0cf.operating_cash_flow || 0) - (y0cf.capital_expenditures || 0), 2);
  const fcf1 = roundTo(y1cf.free_cash_flow || (y1cf.operating_cash_flow || 0) - (y1cf.capital_expenditures || 0), 2);

  // نسبة الدين إلى الحقوق
  const debtRatio0 = y0bal.stockholders_equity > 0 ? roundTo((y0bal.total_debt || 0) / y0bal.stockholders_equity, 2) : 0;
  const debtRatio1 = y1bal.stockholders_equity > 0 ? roundTo((y1bal.total_debt || 0) / y1bal.stockholders_equity, 2) : 0;

  return {
    years: { current: y0inc.fiscal_year, previous: y1inc.fiscal_year },
    profitability: [
      {
        name:     "إجمالي الأصول",
        current:  y0bal.total_assets || 0,
        previous: y1bal.total_assets || 0,
        analysis: getAssetGrowthText(y0bal.total_assets, y1bal.total_assets)
      },
      {
        name:     "هامش صافي الربح",
        current:  margin0,
        previous: margin1,
        isPercent: true,
        analysis: margin0 >= margin1 ? "قوة تسعيرية" : "ضغط على الهامش"
      },
      {
        name:     "العائد على الحقوق ROE",
        current:  roe0,
        previous: roe1,
        isPercent: true,
        analysis: roe0 >= roe1 ? "كفاءة إدارة عالية" : "تراجع في الكفاءة"
      }
    ],
    leverage: [
      {
        name:     "نسبة الدين إلى الحقوق",
        current:  debtRatio0,
        previous: debtRatio1,
        analysis: getDebtRiskText(debtRatio0)
      },
      {
        name:     "التدفق النقدي الحر FCF",
        current:  fcf0,
        previous: fcf1,
        analysis: fcf0 > 0 ? "قدرة نمو قوية" : "ضغط على السيولة"
      }
    ]
  };
}

function getAssetGrowthText(curr, prev) {
  if (!prev || prev === 0) return "—";
  const g = ((curr - prev) / prev) * 100;
  return `نمو ${g > 0 ? "+" : ""}${roundTo(g, 1)}%`;
}

function getDebtRiskText(ratio) {
  if (ratio < 0.5)  return "مخاطر منخفضة";
  if (ratio <= 1.5) return "مخاطر متوسطة";
  return "مخاطر مرتفعة";
}

// ============================================================
// نظام النقاط والقرار الاستثماري - القسم 5
// ============================================================
function calcInvestmentScore(fairValue, price, consensus, quarterlyData, annualData, fcfData) {
  let score = 0;
  const reasons = [];

  // القيمة العادلة
  if (fairValue && price) {
    const diff = ((fairValue - price) / fairValue) * 100;
    if (diff > 10)  { score += 2; reasons.push("يتداول بخصم عن القيمة العادلة"); }
    if (diff < -10) { score -= 2; reasons.push("يتداول بعلاوة عن القيمة العادلة"); }
  }

  // إجماع المحللين
  if (consensus === "شراء" || consensus.toLowerCase() === "buy")  { score += 2; reasons.push("إجماع المحللين: شراء"); }
  if (consensus === "احتفاظ" || consensus.toLowerCase() === "hold") { score += 1; reasons.push("إجماع المحللين: احتفاظ"); }
  if (consensus === "بيع" || consensus.toLowerCase() === "sell")   { score -= 2; reasons.push("إجماع المحللين: بيع"); }

  // نمو الإيرادات YoY
  const revenueRow = (quarterlyData.rows || []).find(r => r.name === "الإيرادات");
  if (revenueRow) {
    if (revenueRow.yoy > 10) { score += 2; reasons.push("نمو إيرادات سنوي قوي"); }
    else if (revenueRow.yoy > 0) { score += 1; reasons.push("نمو إيرادات سنوي إيجابي"); }
    else if (revenueRow.yoy < 0) { score -= 2; reasons.push("تراجع الإيرادات سنوياً"); }
  }

  // نسبة الدين
  const debtRow = (annualData.leverage || []).find(r => r.name === "نسبة الدين إلى الحقوق");
  if (debtRow) {
    if (debtRow.current < 0.5)  { score += 1; reasons.push("مديونية منخفضة"); }
    if (debtRow.current > 1.5)  { score -= 2; reasons.push("مديونية مرتفعة"); }
  }

  // FCF
  if (fcfData.isPositive) { score += 1; reasons.push("تدفق نقدي حر موجب"); }
  else                    { score -= 1; reasons.push("تدفق نقدي حر سالب"); }

  // القرار
  let decision;
  if (score >= 7)      decision = "فرصة شراء قوية";
  else if (score >= 4) decision = "فرصة شراء على المدى المتوسط";
  else if (score >= 1) decision = "احتفاظ مع مراقبة";
  else                 decision = "يُنصح بمراجعة المركز";

  return { score, decision, reasons };
}

function buildVerdict(scoreData, category, fairValue, consensus, quarterlyData, annualData) {
  const revenueRow = (quarterlyData.rows || []).find(r => r.name === "الإيرادات");
  const debtRow    = (annualData.leverage || []).find(r => r.name === "نسبة الدين إلى الحقوق");
  const fcfRow     = (annualData.leverage || []).find(r => r.name === "التدفق النقدي الحر FCF");

  const revenueDir = revenueRow && revenueRow.yoy > 0 ? "صعودي" : "هابط";
  const financial  = debtRow && debtRow.current < 1.5 && fcfRow && fcfRow.current > 0 ? "آمن" : "حرج";
  const valuation  = fairValue.verdict === "مقوم بأقل من قيمته" ? "بخصم" : "بعلاوة";
  const consText   = consensus || "غير محدد";

  return {
    category,
    valuation,
    consensus:    consText,
    revenueDir,
    financial,
    decision:     scoreData.decision,
    score:        scoreData.score,
    reasons:      scoreData.reasons
  };
}

// ============================================================
// دوال مساعدة
// ============================================================
function roundTo(num, decimals) {
  return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}
