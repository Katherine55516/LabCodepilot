/** Reviewed, source-bound cell paraphrases for this input, approved at outline
 * time. Row selection is complete; no fit-time deletion or numeric changes. */
export const ML_TABLE_PROJECTIONS={
 b_0044:[
 ['Which stocks outperform this period?','Will the market or stock rise next period?'],
 ['Stock/date rank or score','Series/date level or direction'],
 ['Forward return relative to peers','Absolute forward return'],
 ['Long-short equity portfolios','Timing overlays and macro/CTA'],
 ['Stocks × dates; wide panel','Dates only; far fewer independent observations'],
 ['Errors partly cancel across long and short positions','Errors affect the whole portfolio at once'],
 ],
 b_0079:[
 ['Most data; reversal and order-flow signals','Microstructure noise, costs and high turnover','Execution-aware, HFT-adjacent strategies'],
 ['Balances signal and turnover','Still noisy; earnings dates can dominate a sub-window','Short-term alpha overlays'],
 ['Standard academic horizon: Gu–Kelly–Xiu / Green–Hand–Zhang','Heavy overlap with daily sampling (Section 4)','Most published equity ML'],
 ['Matches fundamental refresh cadence','Fewer independent periods; slower-moving','Fundamental/value-style ML'],
 ['Persistent quality and low-volatility factors','Very few independent periods: about 30 over 30y','Long-horizon factor timing'],
 ],
 b_0199:[
 ['Trains only on the past; matches actual deployment','Some splits train after validation; less realistic than live deployment'],
 ['1 path','$\\binom{N}{k}$ paths, often dozens to hundreds'],
 ['No variance estimate: one Sharpe/IC result','Distribution of Sharpe/IC; confidence intervals and worst cases'],
 ['Repeated tuning can overfit the single path','Good on few $\\binom{N}{k}$ paths but poor on most signals fragility'],
 ['Low: $N$ sequential folds','High: $\\binom{N}{k}$ models; combinatorial growth with $N$'],
 ['Default for production selection and final backtests','Add a robustness/fragility check before committing capital'],
 ],
 b_0260:[
 ['Full-sample standardization','Full-panel statistics put future distribution information into early training rows.','Use same-date/prior data, never a full-panel scaler; per-date or training-fold fit (§3.1).'],
 ['Restated fundamentals','Latest restatements reveal corrections unavailable to the original trader.','PIT original values and filing dates; Q1 known only on filing, often 30–45 days later. Source cites §12.2.'],
 ['Shuffled cross-validation','Random CV with overlapping forward labels leaks future returns across folds (§5.1).','Time-ordered splits with purging and embargo (§5.2); never shuffle overlapping panel labels.'],
 ['Current-universe survivorship','Today’s survivors exclude bankrupt/delisted losers and overstate historical returns.','Historical PIT membership; retain delisted returns, bankruptcies and securities that later disappear.'],
 ['Unconstrained A-share limit-move labels','Limit-up/down closes may be untradeable; treating them as executable labels overstates opportunity.','Flag/mask limit-move entries/exits; use executable prices or zero weight when untradeable; universe rules (§9).'],
 ],
};
