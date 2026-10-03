/** Deterministic, source-grounded 22-slide outline used by the local PPT-agent run. */
export const slides = [
  { section: 'QUANT RESEARCH', title: 'FACTOR ZOO', shortTitle: 'FACTOR ZOO', focus: 'Theory, evidence and implementation | 理论、证据与实践', role: 'cover', layoutId: 'cover', bullets: [], sourceKeywords: ['Tutorial 04 — The Factor Zoo: Theory and Taxonomy of Equity Factors', 'Theory and Taxonomy of Equity Factors'] },
  { section: 'FOUNDATIONS', title: 'What Is a Factor?', shortTitle: 'Factor vs Alpha', focus: 'Separate firm characteristics, factor returns, ranking signals, anomalies and model alpha.', role: 'architecture', layoutId: 'summary', bullets: [
    'A characteristic is an observable firm trait, such as book-to-market.',
    'A factor is a return series built from a characteristic sort, such as HML.',
    'A signal ranks stocks; alpha is return left unexplained by the chosen model.',
  ], blockHeadings: ['Trait', 'Return', 'Test'], slotOverrides: { '7': 'TRAIT', '8': 'RETURN', '9': 'SIGNAL', '10': 'ALPHA', '12': 'β' }, sourceKeywords: ['1.1 Definitions'] },
  { section: 'DEFINITIONS', title: 'An Anomaly Is Relative to a Benchmark', shortTitle: 'Anomaly Is Relative', focus: 'A return pattern is anomalous only against a specified asset-pricing model.', role: 'comparison', visualIntent: 'comparison', layoutId: 'comparison', bullets: [
    'Characteristic: an observable firm trait, such as book-to-market.',
    'Factor: a return series formed from sorted stocks.',
    'Signal: a cross-sectional score used to rank stocks.',
    'Anomaly: a pattern a chosen benchmark model fails to explain.',
    'Alpha: the regression intercept left unexplained by selected factors.',
    'As benchmarks expand, some earlier anomalies become absorbed exposures.',
  ], blockHeadings: ['Characteristic', 'Factor return', 'Signal', 'Anomaly', 'Alpha', 'Model-relative'], sourceKeywords: ['1.1 Definitions'] },
  { section: 'CAPM', title: 'CAPM Makes a Sharp Beta-Pricing Prediction', shortTitle: 'CAPM Prices Beta', focus: 'Under its assumptions, expected excess returns lie on a linear Security Market Line.', role: 'mechanism', layoutId: 'timeline', bullets: [
    'Expected excess return equals beta times the market risk premium.',
    'Beta is covariance with the market divided by market-return variance.',
    'Only systematic market exposure is priced; idiosyncratic risk is diversifiable.',
  ], blockHeadings: ['Pricing rule', 'Beta', 'Prediction'], sourceChunkIds: ['c_012', 'c_013', 'c_014', 'c_015', 'c_016', 'c_017'], sourceKeywords: ['2.1 CAPM: The Starting Point', '2.1.1 Deriving CAPM from mean-variance optimization (sketch)'] },
  { section: 'CAPM', title: 'CAPM Limits', shortTitle: 'CAPM Limits', focus: 'Observed return patterns and an unobservable market portfolio complicate CAPM tests.', role: 'comparison', visualIntent: 'comparison', layoutId: 'comparison', bullets: [
    'The empirical SML was flatter than CAPM predicts; BAB formalizes the low-beta pattern.',
    'Size and value returns exceeded beta-only predictions.',
    'Roll: the true market includes bonds, real estate and human capital, not only equities.',
  ], blockHeadings: ['Flat SML', 'Size & value', 'Market proxy'], slotOverrides: { '6': 'LOW BETA', '8': 'SIZE / VALUE', '9': 'The empirical SML was flatter than CAPM predicts; BAB formalizes the low-beta pattern. Size and value returns exceeded beta-only predictions.', '14': 'ROLL CRITIQUE', '15': 'Roll: the true market includes bonds, real estate and human capital, not only equities.' }, sourceChunkIds: ['c_018', 'c_019', 'c_020', 'c_021'], sourceKeywords: ['Empirical failures', 'Roll’s critique', "Roll's critique", 'Flat/too-flat SML', 'Size effect', 'Value effect'] },
  { section: 'MODEL LINEAGE', title: 'Each Model Adds a New Explanatory Lens', shortTitle: 'Model Lineage', focus: 'The sequence broadens from market risk to characteristic-based, investment and mispricing structures.', role: 'comparison', visualIntent: 'comparison', layoutId: 'comparison', bullets: [
    'CAPM prices market beta; APT assumes linear factors and no-arbitrage without specifying factor identities.',
    'Fama–French 3 adds size and value; Carhart adds momentum after FF3 leaves momentum returns unexplained.',
    'FF5 adds profitability and investment; HXZ q uses investment-to-assets and return on equity.',
    'Stambaugh–Yuan clusters mispricing; q5 adds expected growth, while model fit still depends on selection.',
    'Models differ in economic grounding, factor construction and anomalies absorbed.',
    'A model’s wider fit must be judged against the way its factors were selected.',
  ], blockHeadings: ['CAPM / APT', 'FF3 / Carhart', 'FF5 / q', 'SY / q5', 'Trade-offs', 'Evaluation'], sourceKeywords: ['2.8 Summary Table of Models'] },
  { section: 'FAMA–FRENCH 3', title: 'FF3 Builds Six Value-Weighted Portfolios', shortTitle: 'Fama–French 3', focus: 'The 2×3 sort constructs SMB and HML alongside the market factor.', role: 'process', visualIntent: 'pipeline', layoutId: 'timeline', bullets: [
    'MKT captures the market excess return; SMB is small minus big.',
    'Each June, sort on size and book-to-market using the median and 30/70 breakpoints.',
    'Six value-weighted portfolios produce size- and value-balanced spreads.',
  ], blockHeadings: ['Market', '2×3 sort', 'Six portfolios'], slotOverrides: {
    '7': 'MKT', '8': 'MARKET', '9': 'Market excess return',
    '10': 'SMB', '11': 'SIZE', '12': 'Small minus big',
    '13': 'HML', '14': 'VALUE', '15': 'High B/M minus low B/M',
    '16': '2×3', '17': 'SORT', '18': 'Six portfolios',
  }, sourceKeywords: ['2.3 Fama-French Three-Factor Model'] },
  { section: 'MOMENTUM', title: 'Carhart Adds a Defined Momentum Return', shortTitle: 'Carhart MOM', focus: 'UMD is the winner-minus-loser spread added to FF3.', role: 'mechanism', layoutId: 'timeline', bullets: [
    'Carhart’s four-factor model appends UMD to MKT, SMB and HML.',
    'Rank stocks on cumulative returns from t−12 to t−2, skipping the latest month; typical cuts use top/bottom 30% or deciles.',
    'Sharp rebounds can trigger momentum crashes.',
  ], blockHeadings: ['Add UMD', 'Formation window', 'Failure mode'], sourceKeywords: ['2.4 Carhart Four-Factor Model'] },
  { section: 'PROFITABILITY & INVESTMENT', title: 'FF5 Links Returns to Profitability and Investment', shortTitle: 'FF5 Adds RMW + CMA', focus: 'RMW and CMA extend the factor set while HML’s marginal role becomes sample-dependent.', role: 'comparison', visualIntent: 'comparison', layoutId: 'summary', bullets: [
    'RMW is robust-minus-weak profitability; CMA is conservative-minus-aggressive investment.',
    'The model adds a dividend-discount rationale for profitability and investment.',
    'HML can become partly redundant in some samples; that remains debated.',
  ], blockHeadings: ['RMW', 'CMA', 'HML caveat'], slotOverrides: {
    '7': 'RMW', '8': 'CMA', '9': 'HML', '10': '5F', '11': 'FF5 factor set', '12': '5F',
    '13': 'RMW is robust-minus-weak profitability; CMA is conservative-minus-aggressive investment. The model adds a dividend-discount rationale for profitability and investment. HML can become partly redundant in some samples; that remains debated.',
    '14': 'HML redundancy varies by sample.',
  }, sourceKeywords: ['2.5 Fama-French Five-Factor Model'] },
  { section: 'Q-FACTOR MODELS', title: 'The q Model Uses Investment-Based Factors', shortTitle: 'q and q5 Models', focus: 'HXZ links expected returns to investment and profitability, then adds expected growth in q5.', role: 'architecture', layoutId: 'timeline', bullets: [
    'q uses MKT, ME, investment-to-assets (I/A) and return on equity (ROE).',
    'Independent size, investment and profitability sorts form 27 portfolios; q5 adds expected growth (EG).',
    'The model is more detailed but still depends on sample and construction choices.',
  ], blockHeadings: ['q4 factors', 'Independent sorts', 'q5 adds EG'], sourceKeywords: ['2.6 The q-Factor Model'] },
  { section: 'MISPRICING MODEL', title: 'Stambaugh–Yuan Clusters Anomaly Signals', shortTitle: 'MGMT + PERF', focus: 'Two composite mispricing factors summarize 11 anomaly characteristics, with a post-hoc testing caveat.', role: 'comparison', visualIntent: 'comparison', layoutId: 'comparison', bullets: [
    'MGMT clusters investment/accrual anomalies; PERF clusters profitability/momentum patterns.',
    'Both summarize 11 known anomaly characteristics.',
    'Its anomaly horse-race advantage needs caution because construction is post hoc.',
  ], blockHeadings: ['MGMT', 'PERF', 'Post-hoc caveat'], slotOverrides: { '6': 'MGMT', '8': 'PERF', '9': 'MGMT clusters investment/accrual anomalies; PERF clusters profitability/momentum patterns. Both summarize 11 known anomaly characteristics.', '14': 'POST-HOC', '15': 'Its anomaly horse-race advantage needs caution because construction is post hoc.' }, sourceKeywords: ['2.7 Stambaugh-Yuan Mispricing Factors'] },
  { section: 'MODEL TESTING', title: 'Time-Series, Cross-Section and GRS Answer Different Questions', shortTitle: 'Testing Models', focus: 'Regression design should match the pricing question; GRS tests joint-zero alphas across test assets.', role: 'comparison', visualIntent: 'comparison', layoutId: 'comparison', bullets: [
    'Time-series regression tests portfolio returns against factor returns.',
    'Cross-sectional tests explain average-return differences across assets.',
    'GRS tests joint-zero alphas; results depend on test assets and covariance estimates.',
  ], blockHeadings: ['Time series', 'Cross section', 'GRS test'], slotOverrides: { '6': 'Time-series regression tests portfolio returns against factor returns. Cross-sectional tests explain average-return differences across assets. GRS tests joint-zero alphas; results depend on test assets and covariance estimates.', '7': 'TS', '8': 'RETURNS', '9': 'Portfolio returns on factor returns', '10': 'CS', '11': 'AVERAGES', '12': 'Traits or betas explain differences', '13': 'GRS', '14': 'JOINT α', '15': 'Joint-zero alpha test', '16': '1', '17': 'DIAG', '18': 'Not a final verdict' }, sourceKeywords: ['3. Time-Series vs. Cross-Sectional Models', 'Gibbons-Ross-Shanken test'] },
  { section: 'WHY PREMIA EXIST', title: 'Three Stories Explain Factor Premia', shortTitle: 'Premia Stories', focus: 'A useful theory predicts not only why a factor earns a premium, but when it may fail.', role: 'comparison', visualIntent: 'comparison', layoutId: 'comparison', bullets: [
    'Risk compensation pays for bad-state exposure.',
    'Behavioral errors include overreaction, underreaction and extrapolation.',
    'Arbitrage limits, shorting costs, funding and mandates slow price correction.',
    'Value, momentum, low-volatility and size each have failure stories.',
  ], blockHeadings: ['Risk', 'Behavior', 'Frictions', 'Failure tests'], sourceKeywords: ['1.2 Risk Factors vs. Mispricing Factors', '4. Why Do Factors Earn Premia?'] },
  { section: 'FACTOR ZOO', title: 'A Published Anomaly Is a Hypothesis, Not a Prize', shortTitle: 'Multiple Testing', focus: 'Many findings are aliases, absorbed exposures, untradeable signals or false discoveries.', role: 'comparison', visualIntent: 'comparison', layoutId: 'comparison', bullets: [
    'Aliases may share one latent exposure.',
    'Known factors can absorb an anomaly.',
    'Trading costs can erase the premium.',
    'Many trials make a t-stat above 2 weak evidence; require a rationale, point-in-time data, robustness and independent confirmation.',
    'Require rationale, point-in-time data, robustness and incremental value.',
  ], blockHeadings: ['Aliases', 'Subsumed', 'Costs', 'Selection', 't-stat', 'Minimum bar'], sourceKeywords: ['5. The Factor Zoo Problem'] },
  { section: 'FACTOR SCORECARD', title: 'Evaluate Risk, Mispricing and Data-Mining Together', shortTitle: 'Factor Scorecard', focus: 'A scorecard frames the evidence and the factor’s failure conditions; it is not a verdict.', role: 'evidence', layoutId: 'summary', bullets: [
    'Value reflects distress risk and extrapolation; metric choice invites mining.',
    'Momentum has crash exposure and parameter-search risk.',
    'Quality and investment pair cash-flow stories with definition choices.',
    'Low-risk, size and liquidity face leverage, funding or trading frictions.',
    'For every factor, name evidence that would falsify it.',
  ], blockHeadings: ['Value', 'Momentum', 'Quality', 'Risk / size'], slotOverrides: {
    '5': 'For every factor, name evidence that would falsify it.',
    '7': 'VALUE', '8': 'MOMENTUM', '9': 'QUALITY', '10': 'RISK', '11': 'Three lenses, not a verdict.',
    '12': 'R/M',
    '13': 'Value reflects distress risk and extrapolation; metric choice invites mining. Momentum has crash exposure and parameter-search risk. Quality and investment pair cash-flow stories with definition choices.',
    '14': 'Low-risk, size and liquidity face leverage, funding or trading frictions.',
  }, sourceKeywords: ['6. Risk vs. Mispricing vs. Data-Mining'] },
  { section: 'TAXONOMY', title: 'Factor Families Need Their Own Controls', shortTitle: 'Factor Families', focus: 'Signals belong to distinct families, and each family has characteristic confounds.', role: 'architecture', layoutId: 'summary', bullets: [
    'Value: B/P, E/P, EBIT/EV and CFO/P; control industry, profitability and leverage.',
    'Momentum: 12–1, residual and earnings signals; quality: GP/A, ROE and accruals.',
    'Investment uses asset growth, capex and net issuance; low-risk uses beta and volatility; liquidity uses spreads and turnover.',
    'Sentiment and alternative data: revisions, short interest, news tone and web signals.',
  ], blockHeadings: ['Value + momentum', 'Investment / risk', 'Sentiment / alternative'], slotOverrides: {
    '8': 'Value + momentum',
    '9': 'Value: B/P, E/P, EBIT/EV and CFO/P; control industry, profitability and leverage. Momentum: 12–1, residual and earnings signals; quality: GP/A, ROE and accruals.',
    '12': 'Investment / risk',
    '13': 'Investment and low-risk use asset growth, beta and volatility; liquidity uses spreads and turnover.',
    '16': 'Sentiment / alt',
    '17': 'Sentiment and alternative data: revisions, short interest, news tone and web signals.',
  }, sourceKeywords: ['7. Factor Taxonomy'] },
  { section: 'PORTFOLIO CONSTRUCTION', title: 'A Signal’s Portfolio Expression Changes the Test', shortTitle: 'Portfolio Forms', focus: 'Academic spreads, long-only tilts and risk-model portfolios answer different questions.', role: 'comparison', visualIntent: 'comparison', layoutId: 'comparison', bullets: [
    'Decile or rank-weighted dollar-neutral portfolios test the premium; long-only benchmark tilts test constrained stock selection.',
    'Residualized signals fit constrained optimizers; factor-mimicking portfolios serve risk models.',
    'Report weighting, rebalancing frequency, breakpoint universe, sector and beta neutrality, leverage, and cost assumptions.',
  ], blockHeadings: ['Portfolio forms', 'Purpose', 'Report choices'], slotOverrides: { '6': 'Long–short', '8': 'BENCHMARK TILT', '14': 'REPORT THE DESIGN', '15': 'Weights · rebalance · universe · neutrality · leverage · costs' }, sourceKeywords: ['8. Styles of Factor Portfolio Construction'] },
  { section: 'TIMING & CROWDING', title: 'Timing Adds Risk; Crowding Adds Exit Risk', shortTitle: 'Timing & Crowding', focus: 'Diversification and drawdown-aware budgets are safer defaults than aggressive timing.', role: 'comparison', visualIntent: 'comparison', layoutId: 'comparison', bullets: [
    'Timing signals include valuation spreads, recent returns, macro regimes and volatility—but each adds more tests.',
    'Crowding can persist until liquidity vanishes, then unwind sharply.',
    'Monitor flows, shared holdings, short interest, borrow, turnover and manager correlation.',
  ], blockHeadings: ['Timing', 'Crowding', 'Monitor'], slotOverrides: {
    '6': 'Timing signals include valuation spreads, recent returns, macro regimes and volatility—but each adds more tests. Crowding can persist until liquidity vanishes, then unwind sharply. Monitor flows, shared holdings, short interest, borrow, turnover and manager correlation.',
    '7': 'SPREAD', '8': 'TIMING', '9': 'Test across regimes', '10': 'CROWD', '11': 'FLOW', '12': 'Watch liquidity',
    '13': 'COST', '14': 'BORROW', '15': 'Track borrow and turnover', '16': 'RISK', '17': 'DIVERSIFY', '18': 'Budget drawdowns',
  }, sourceKeywords: ['9. Factor Timing and Factor Crowding'] },
  { section: 'A-SHARES', title: 'A U.S. Factor Is a Hypothesis in A-Shares', shortTitle: 'U.S. vs A-Shares', focus: 'Market structure, investor base, short-sale limits, disclosure and regulation alter factor behavior.', role: 'comparison', visualIntent: 'comparison', layoutId: 'timeline', bullets: [
    'US momentum is canonical; A-share momentum is more horizon- and limit-event-dependent.',
    'A-share size is shaped by shell value and quant crowding.',
    'Quality screens must watch subsidies, related parties and earnings management.',
  ], blockHeadings: ['Momentum', 'Size', 'Quality'], slotOverrides: {
    '11': 'U.S. momentum is canonical; A-share momentum depends on horizon and limit events.',
    '16': 'A-share size reflects shell value and quant crowding.',
    '21': 'Quality screens must account for subsidies, related parties and earnings-management incentives.',
    '23': 'A factor imported across markets is a hypothesis, not parameter-free truth.',
    '24': 'Market structure changes how the same signal behaves.',
  }, sourceKeywords: ['10. Factors in the US vs A-Shares'] },
  { section: '2×3 SORT', title: 'Independent Breakpoints Form Six Portfolios', shortTitle: 'The 2×3 Sort', focus: 'Sort size into small/big and a characteristic into low/mid/high, then form six groups.', role: 'process', visualIntent: 'pipeline', layoutId: 'summary', bullets: [
    'Split the universe into small and big by market capitalization; independently sort the chosen characteristic into low, middle and high buckets.',
    'Cross the size and characteristic rankings to form six portfolios; compare high with low within each size group.',
    'HML = ½(SmallHigh + BigHigh) − ½(SmallLow + BigLow).',
  ], blockHeadings: ['Size split', 'Six portfolios', 'HML'], slotOverrides: {
    '7': 'SIZE', '8': '2×3', '9': '6 PORTS', '10': 'HML', '11': 'Independent portfolios', '12': 'HML',
    '13': 'Sort size into small/big, then the signal into low/mid/high. Form six portfolios; compare high versus low within each size bucket. HML = ½(SmallHigh + BigHigh) − ½(SmallLow + BigLow).',
    '14': 'Breakpoints limit size-proxy risk.',
  }, sourceKeywords: ['11. Worked Example: A 2×3 Sort'] },
  { section: 'FACTOR TO STRATEGY', title: 'A Factor Becomes a Strategy Only After Implementation', shortTitle: 'Strategy Path', focus: 'Move from rationale through investable tests, constraints, monitoring and governance.', role: 'process', visualIntent: 'pipeline', layoutId: 'summary', bullets: [
    'Define universe, forecasts, construction, execution and risk limits.',
    'Test rationale, incrementality, robustness, costs and capacity.',
    'Red-team, paper-trade, then consider a small live allocation.',
  ], blockHeadings: ['Design', 'Validate', 'Deploy'], slotOverrides: {
    '7': 'DESIGN', '8': 'TEST', '9': 'COSTS', '10': 'DEPLOY', '11': 'Nine-step workflow', '12': '9',
    '13': 'Define universe, forecasts, construction, execution and risk limits. Test rationale, incrementality, robustness, costs and capacity. Red-team, paper-trade, then consider a small live allocation.',
    '14': 'Paper-trade before a small live allocation.',
  }, sourceKeywords: ['12. From Factors to Strategies'] },
  { section: 'RESEARCH CHECKLIST', title: 'Good Factor Research Combines Evidence and Humility', shortTitle: 'Factor Checklist', focus: 'The factor zoo is a library and a warning: noisy data rewards discipline, cost realism and regime humility.', role: 'closing', visualIntent: 'process', layoutId: 'conclusion', bullets: [
    'Use a priori rationale, point-in-time data, exposure controls and incremental value.',
    'Use conservative tests; compare IC and sorts; test a reasonable range across horizons and broader samples.',
    'Realistic turnover rates; realistic costs; available borrow; enough capacity and liquidity.',
    'Record false discoveries; monitor risk, assign a review owner and reassess by regime.',
  ], blockHeadings: ['Research premise', 'Validation', 'Implementation', 'Governance'], slotOverrides: {
    '10': [
      { label: 'POINT-IN-TIME', body: 'No look-ahead; rationale first.' },
      { label: 'NEUTRALIZE', body: 'Control obvious exposures.' },
      { label: 'RANGE', body: 'Test horizons and universes.' },
      { label: 'INCREMENTAL', body: 'Reject aliases.' },
    ],
    '16': [
      { label: 'CROSS-CHECK', body: 'Neutralize; compare IC, sorts, regressions.' },
      { label: 'ROBUST', body: 'Horizon and universe checks.' },
      { label: 'AGREE', body: 'IC, sorts and regressions.' },
      { label: 'UNIQUE', body: 'Add incremental value.' },
    ],
    '22': [
      { label: 'NET COSTS', body: 'Test horizons; reject aliases; net costs.' },
      { label: 'SELECTION', body: 'Record multiple-testing controls.' },
      { label: 'CAPACITY', body: 'Check borrow and liquidity.' },
      { label: 'INVESTABLE', body: 'Respect portfolio constraints.' },
    ],
    '28': [
      { label: 'FAILURE', body: 'Failure case; monitor; govern.' },
      { label: 'MONITOR', body: 'Set risk signals.' },
      { label: 'GOVERNANCE', body: 'Assign review and control.' },
      { label: 'REGIMES', body: 'Reassess as markets change.' },
    ],
  }, sourceKeywords: ['13. Practical Checklist', '14. Summary'] },
];
