// public/screens/grow.js — Grow (v15 Phase 10): getting better at it. Results (what's working, why
// videos were rejected), Communicate (how people take in information), and Mindset (the
// agent's own). One stop with three tabs; Communicate and Mindset are the pages they always were.
import { S, can, esc, loadCfg, main } from '../app.js';
import { loadVideos, rejectionsPanel, resultsPanel } from './review.js';

const TABS = [['grow', 'Results', () => can('view')], ['communicate', 'Communicate', () => can('coach') || can('replies')], ['mindset', 'Mindset', () => can('mindset')]];
const growTabs = () => {
  const list = TABS.filter(x => x[2]());
  return list.length > 1 ? `<nav class="subnav" aria-label="Grow">${list.map(([k, l]) => `<a href="#/${k}"${S.view === k ? ' aria-current="page"' : ''}>${esc(l)}</a>`).join('')}</nav>` : '';
};
async function viewGrow() {
  await Promise.all([loadVideos(), loadCfg().catch(() => {})]);
  drawGrow();
}
function drawGrow() {
  const st = S.stats || { topics: [], rejections: [] };
  const any = st.topics.length || (st.rejections || []).length;
  main.innerHTML = `<div class="head"><h1>Grow</h1><p class="lede">What’s bringing people to you, what to try next, and how you talk to them.</p></div>
    ${growTabs()}
    ${st.topics.length ? resultsPanel(st) : ''}
    ${rejectionsPanel(st)}
    ${any ? '' : '<p class="empty">Results show up here once videos are posted and their views and messages are in.</p>'}`;
}
export { drawGrow, growTabs, viewGrow };
