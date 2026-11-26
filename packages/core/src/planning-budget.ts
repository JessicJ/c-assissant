/** Dates and party counts elsewhere in a message are not a budget amount. */
export function hasStatedBudgetAmount(value: string | undefined, budgetFact = false): boolean {
  if (!value) return false;
  return value.split(/[。；;\n，,](?!\d{3}(?:\D|$))/u).some((clause) => {
    if (/不设(?:固定)?预算|没有(?:固定)?预算|预算不限|不限预算|no (?:fixed |set )?budget|budget (?:is )?(?:unlimited|not fixed)/iu.test(clause)) return false;
    if (budgetFact) return /\d/u.test(clause);
    return /(?:人民币|RMB|CNY)\s*[¥￥]?\s*\d|\d[\d,.]*\s*(?:万元?人民币|元人民币|RMB|CNY)/iu.test(clause)
      || /预算(?:\s|约|大约|大概|是|为|在|总计|控制在|人均|每人|[:：])*[¥￥]?\s*\d/u.test(clause)
      || /\bbudget\s*(?:(?:of|around|about|is|roughly|up to)\s+|[:=]\s*)?[$€£¥￥]?\s*\d/iu.test(clause);
  });
}
