// templates.js — starter content for each product line.
// Written to pass the platform rules: every fact is general, carries a qualifier
// ("usually", "often", "many"…), and has no numbers, prices, company names or government language.
// Nothing here is used in a video until the agent confirms it is true for what they sell.

const fact = (id, text, links) => ({ id, text, links, confirmed: false, confirmedAt: '', source: '', ai: false });

export const TEMPLATES = {
  final_expense: {
    label: 'Final expense',
    audiences: [
      { id: 'fe_a1', text: 'Seniors on a fixed income (60+)', visual: 'older adults in their 60s and 70s' },
      { id: 'fe_a2', text: 'Adults 50 to 64 planning ahead', visual: 'adults in their 50s' },
      { id: 'fe_a3', text: 'Adult children of aging parents', visual: 'an adult daughter or son with an elderly parent' },
      { id: 'fe_a4', text: 'Grandparents helping raise their grandkids', visual: 'grandparents with young grandchildren' },
    ],
    painPoints: [
      { id: 'fe_p1', text: 'I don’t want my kids paying for my funeral.', links: ['fe_a1', 'fe_a2'], question: 'how much coverage would actually cover your final expenses' },
      { id: 'fe_p2', text: 'I’m on a fixed income. I can’t afford much.', links: ['fe_a1'], question: 'what kind of coverage fits your monthly budget' },
      { id: 'fe_p3', text: 'I have health problems. Nobody will cover me.', links: ['fe_a1', 'fe_a2'], question: 'which policies you could apply for with your health history' },
      { id: 'fe_p4', text: 'What happens to the grandkids if something happens to me?', links: ['fe_a4'], question: 'how to make sure the people raising them aren’t left with the bills' },
      { id: 'fe_p5', text: 'Mom never talked about what she wants. What if we’re not ready?', links: ['fe_a3'], question: 'how to start that conversation and what a plan for her could look like' },
      { id: 'fe_p6', text: 'I have coverage through work. Is that enough?', links: ['fe_a2'], question: 'whether your work coverage follows you into retirement' },
    ],
    insights: [
      fact('fe_i1', 'Final expense insurance is usually a small whole life policy meant to cover funeral and end-of-life costs.', ['fe_p1', 'fe_p5']),
      fact('fe_i2', 'Many final expense policies ask a few health questions instead of requiring a medical exam.', ['fe_p3']),
      fact('fe_i3', 'Policies that accept almost anyone usually have a waiting period before the full benefit is paid.', ['fe_p3']),
      fact('fe_i4', 'With whole life final expense, the premium usually stays the same for life.', ['fe_p2']),
      fact('fe_i5', 'Final expense policies often come in smaller amounts, which keeps the premium smaller too.', ['fe_p2', 'fe_p1']),
      fact('fe_i6', 'Life insurance through work often ends when you retire or leave that job.', ['fe_p6']),
      fact('fe_i7', 'A payout to a named beneficiary usually skips probate, so it often arrives faster.', ['fe_p4', 'fe_p5']),
      fact('fe_i8', 'Applying younger usually means lower premiums.', ['fe_p6', 'fe_p4']),
    ],
    solutions: [
      { id: 'fe_s1', text: 'Final expense whole life', plain: 'final expense coverage: a small whole life policy for funeral costs', links: ['fe_i1', 'fe_i4', 'fe_i5', 'fe_i7', 'fe_i8'], mustMention: '' },
      { id: 'fe_s2', text: 'Simplified issue final expense', plain: 'a final expense policy that may skip the medical exam', links: ['fe_i2', 'fe_i1'], mustMention: '' },
      { id: 'fe_s3', text: 'Guaranteed acceptance final expense', plain: 'a final expense policy built for tougher health histories, with a waiting period', links: ['fe_i3'], mustMention: 'waiting period' },
      { id: 'fe_s4', text: 'Individual life policy', plain: 'a policy you own yourself, separate from your job', links: ['fe_i6', 'fe_i8', 'fe_i7'], mustMention: '' },
    ],
  },

  mortgage: {
    label: 'Mortgage protection',
    audiences: [
      { id: 'mp_a1', text: 'Young families who just bought a home', visual: 'young parents with kids at home' },
      { id: 'mp_a2', text: 'Couples who need both paychecks for the house payment', visual: 'a couple in their 30s or 40s at home' },
      { id: 'mp_a3', text: 'Single parents who own their home', visual: 'a single mom or dad with kids at home' },
      { id: 'mp_a4', text: 'Homeowners in their 50s still paying a mortgage', visual: 'a couple in their 50s at home' },
    ],
    painPoints: [
      { id: 'mp_p1', text: 'If something happened to me, could my family keep the house?', links: ['mp_a1', 'mp_a3', 'mp_a4'], question: 'how much coverage would keep your family in your home' },
      { id: 'mp_p2', text: 'We need both paychecks to make the house payment.', links: ['mp_a2'], question: 'how to protect the house on either income' },
      { id: 'mp_p3', text: 'I figured my lender or my job already had us covered.', links: ['mp_a1', 'mp_a2', 'mp_a4'], question: 'whether the coverage you have now would really pay off your home' },
      { id: 'mp_p4', text: 'What if I get really sick before the house is paid off?', links: ['mp_a3', 'mp_a4'], question: 'which options fit your health and your home' },
      { id: 'mp_p5', text: 'I keep putting this off because it feels complicated.', links: ['mp_a1', 'mp_a2', 'mp_a3'], question: 'what a simple plan for your mortgage could look like' },
    ],
    insights: [
      fact('mp_i1', 'Mortgage life insurance from a lender usually pays the lender, not your family.', ['mp_p3', 'mp_p1']),
      fact('mp_i2', 'A policy you own usually pays the people you choose, and they decide how to use it.', ['mp_p1', 'mp_p3']),
      fact('mp_i3', 'Coverage through work usually ends if you leave or lose that job.', ['mp_p3']),
      fact('mp_i4', 'A term policy is often matched to the years left on your mortgage.', ['mp_p1', 'mp_p2', 'mp_p5']),
      fact('mp_i5', 'Couples often cover both incomes, with a policy on each person or one joint policy.', ['mp_p2']),
      fact('mp_i6', 'Many term policies offer a rider that pays part of the benefit early if you’re diagnosed with a terminal illness.', ['mp_p4']),
      fact('mp_i7', 'Rates are generally based on age and health, so applying sooner often costs less.', ['mp_p4', 'mp_p5']),
      fact('mp_i8', 'Some mortgage protection policies shrink as your balance goes down, while level term stays the same.', ['mp_p1', 'mp_p5']),
    ],
    solutions: [
      { id: 'mp_s1', text: 'Mortgage protection term life', plain: 'a term policy matched to your mortgage', links: ['mp_i1', 'mp_i2', 'mp_i4', 'mp_i7', 'mp_i8'], mustMention: '' },
      { id: 'mp_s2', text: 'Term life with living benefits', plain: 'a term policy with a living benefits rider', links: ['mp_i6'], mustMention: '' },
      { id: 'mp_s3', text: 'Coverage on both incomes', plain: 'coverage on both of your incomes', links: ['mp_i5'], mustMention: '' },
      { id: 'mp_s4', text: 'Individual life policy', plain: 'a policy you own yourself, separate from your job', links: ['mp_i3', 'mp_i2'], mustMention: '' },
    ],
  },

  family: {
    label: 'Family protection',
    audiences: [
      { id: 'fp_a1', text: 'Parents with young kids', visual: 'parents with young children at home' },
      { id: 'fp_a2', text: 'Stay-at-home parents', visual: 'a mom or dad at home with young kids' },
      { id: 'fp_a3', text: 'Single parents', visual: 'a single mom or dad with kids' },
      { id: 'fp_a4', text: 'Newlyweds and couples starting a family', visual: 'a young couple in their late 20s or 30s' },
    ],
    painPoints: [
      { id: 'fp_p1', text: 'If I wasn’t here, how would my kids get by?', links: ['fp_a1', 'fp_a3'], question: 'how much coverage would carry your kids through' },
      { id: 'fp_p2', text: 'I already have life insurance through work.', links: ['fp_a1', 'fp_a4'], question: 'whether your work coverage would really be enough for your family' },
      { id: 'fp_p3', text: 'I don’t bring home a paycheck, so I don’t need coverage.', links: ['fp_a2'], question: 'what it would take to cover everything you do at home' },
      { id: 'fp_p4', text: 'Life insurance feels too expensive right now.', links: ['fp_a1', 'fp_a3', 'fp_a4'], question: 'what coverage fits your budget' },
      { id: 'fp_p5', text: 'We just started our family and haven’t thought about it.', links: ['fp_a4'], question: 'what you two would want in place' },
    ],
    insights: [
      fact('fp_i1', 'Many parents choose a term that lasts until their kids are grown.', ['fp_p1', 'fp_p5']),
      fact('fp_i2', 'Life insurance through work often isn’t enough to replace your income for long.', ['fp_p2']),
      fact('fp_i3', 'Coverage through work usually ends if you leave or lose that job.', ['fp_p2']),
      fact('fp_i4', 'Replacing what a stay-at-home parent does, like childcare, often costs a family a lot.', ['fp_p3']),
      fact('fp_i5', 'Term life generally costs less than whole life for the same amount of coverage.', ['fp_p4']),
      fact('fp_i6', 'Rates are usually based on your age and health, so applying younger often costs less.', ['fp_p4', 'fp_p5']),
      fact('fp_i7', 'A payout to a named beneficiary usually skips probate, so it often arrives faster.', ['fp_p1']),
      fact('fp_i8', 'Stay-at-home parents are often able to get their own coverage, even without a paycheck.', ['fp_p3']),
    ],
    solutions: [
      { id: 'fp_s1', text: 'Term life insurance', plain: 'coverage for a set number of years', links: ['fp_i1', 'fp_i5', 'fp_i6', 'fp_i7', 'fp_i2'], mustMention: '' },
      { id: 'fp_s2', text: 'Coverage for a stay-at-home parent', plain: 'a policy for the parent at home', links: ['fp_i4', 'fp_i8'], mustMention: '' },
      { id: 'fp_s3', text: 'Individual life policy', plain: 'a policy you own yourself, separate from your job', links: ['fp_i2', 'fp_i3'], mustMention: '' },
    ],
  },
};

// Story content for the product lines an agent sells, merged into one routing map.
export function starterStory(products) {
  const ids = (products || []).filter(p => TEMPLATES[p]);
  const story = { audiences: [], painPoints: [], insights: [], solutions: [] };
  (ids.length ? ids : ['final_expense']).forEach(p => {
    const t = JSON.parse(JSON.stringify(TEMPLATES[p]));
    Object.keys(story).forEach(k => story[k].push(...t[k].map(x => ({ ...x, product: p }))));
  });
  return story;
}
