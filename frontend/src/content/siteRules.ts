// Hardcoded, per-site blur rules.
//
// The generic pre-filter in simplify.ts reasons from shape (is it a nav? a rail? an
// ad?), which is the right default but can't know that a specific site's like count,
// award badge or team list is exactly the social-proof noise a distracted user gets
// pulled into. For the handful of sites we care enough to hand-tune, this module names
// those regions by selector.
//
// Same machinery as everything else: snapshot with saveOriginal(), toggle a class,
// so restoreOriginalPage() undoes these with no special case.

import { DEEMPHASIZE_CLASS, isVisible } from './dom-heuristics'
import { saveOriginal } from './originalState'

// Deliberately NOT the generic DEEMPHASIZE_CLASS: that rule un-blurs nested links and
// buttons so secondary content stays usable, and every target here (Like button,
// Comment button, team member links, tab links) IS a link. Blurring social proof only
// works if it covers the interactive bits too.
export const HARD_BLUR_CLASS = 'distill-hard-blur'

export interface SiteRule {
  name: string
  // Matches against window.location — both parts must pass.
  hostPattern: RegExp
  pathPattern: RegExp
  // Extra guard for pages the URL alone can't distinguish (e.g. /software/search
  // is not a project page). Runs after the URL match.
  confirm?: () => boolean
  // Everything matching these is blurred. Missing selectors are simply skipped, so
  // a Devpost markup change degrades to "blurs less", never to a broken page.
  blurSelectors: string[]
  // Suppresses the 760px reading column and the text upscale. Set it for any page
  // whose main region is a real multi-column layout rather than an article: forcing
  // the column squeezes the whole page into a strip and wraps the rail one word per
  // line. On a hand-tuned page the blur is the whole intended change.
  disableReadingColumn?: boolean
}

// --- Devpost project pages -------------------------------------------------
// https://devpost.com/software/<slug>. Blurs the comparison/status surface — likes,
// comment counts, the Story/Updates tabs, the "Submitted to" award panel, the team
// roster, and the bottom like bar with its "N people like this" faces — leaving the
// title, the gallery and the actual project write-up sharp.
const DEVPOST_PROJECT: SiteRule = {
  name: 'devpost-project',
  hostPattern: /(^|\.)devpost\.com$/i,
  pathPattern: /^\/software\/[^/]+\/?$/i,
  // /software/search, /software/popular, /software/new all match the path pattern.
  // A real project page is the only one with the project header on it.
  confirm: () => !!document.getElementById('software-header'),
  blurSelectors: [
    // Site chrome across the top.
    '#global-nav',
    // Like / Comment buttons under the title (the title itself stays sharp).
    '#software-header .software-likes',
    '#software-comment-button',
    // Story | Updates tabs, including the update count.
    '#software-nav',
    // Right rail: "Submitted to" + WINNER badges, and "Created by" team list.
    '#submissions',
    '#app-team',
    // Bottom bar: Like button, "N people like this", liker avatars.
    '#share-and-like',
  ],
  // The story and the "Submitted to"/"Created by" rail are siblings inside one grid;
  // isProseLike() sees enough prose to claim the whole thing and narrows it.
  disableReadingColumn: true,
}

const SITE_RULES: SiteRule[] = [DEVPOST_PROJECT]

export function findSiteRule(loc: Location = window.location): SiteRule | null {
  return (
    SITE_RULES.find(
      (rule) =>
        rule.hostPattern.test(loc.hostname) &&
        rule.pathPattern.test(loc.pathname) &&
        (rule.confirm?.() ?? true),
    ) ?? null
  )
}

// Returns how many elements were blurred; 0 when no rule matches this page.
export function applySiteRules(): number {
  const rule = findSiteRule()
  if (!rule) return 0

  const targets = new Set<Element>()
  rule.blurSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      if (isVisible(el)) targets.add(el)
    })
  })

  targets.forEach((el) => {
    saveOriginal(el)
    // The generic pass may already have dimmed this one (Devpost's #global-nav is a
    // nav, its right rail looks like a sidebar). CSS filters compound, so drop the
    // generic class rather than stacking two blurs on the same element.
    el.classList.remove(DEEMPHASIZE_CLASS)
    el.classList.add(HARD_BLUR_CLASS)
  })

  return targets.size
}
