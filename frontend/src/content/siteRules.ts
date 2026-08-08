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

import {
  AD_HIDDEN_CLASS,
  DEEMPHASIZE_CLASS,
  isVisible,
  SECTION_HIDDEN_CLASS,
  UNSTICK_FIXED_CLASS,
  UNSTICK_STICKY_CLASS,
} from './dom-heuristics'
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
  // Elements that must stay sharp and clickable. A CSS filter on an ancestor blurs
  // its whole subtree and a child cannot opt out, so this can't be a style rule — it
  // clears the blur classes off each match's ancestor chain instead. blurSelectors
  // therefore has to name the *siblings* to blur, not a container; these are the
  // backstop against a container getting blurred by one of the generic passes.
  keepSharpSelectors?: string[]
  // Suppresses the 760px reading column and the text upscale. Set it for any page
  // whose main region is a real multi-column layout rather than an article: forcing
  // the column squeezes the whole page into a strip and wraps the rail one word per
  // line. On a hand-tuned page the blur is the whole intended change.
  disableReadingColumn?: boolean
  // Same job as keepSharpSelectors, for a target no static CSS selector can name —
  // e.g. AccuWeather's inline "further reading" callouts, which carry no distinguishing
  // class and are only recognizable by their own bracket-wrapped text convention.
  keepSharpMatcher?: () => Element[]
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
    // Site chrome across the top — the menus, search and account controls, but not
    // the title area holding the Devpost logo. :not(.title-area) is for the mobile
    // bar, whose logo <ul> carries both classes.
    '#global-nav .top-bar-section:not(.title-area)',
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
    // The "write a comment" composer under the updates. Devpost only renders the
    // form when you're signed in and shows a "Log in ... to join the conversation"
    // line when you're not, so both shapes are listed. The :has() rules climb to the
    // row that holds the avatar next to the box, since the avatar sits outside the
    // <form> itself; the bare `form` entry is the fallback if that markup changes.
    '.software-update-comments .media:has(form)',
    '.software-update-comments li:has(form)',
    '.software-update-comments form',
    '.join-the-conversation',
  ],
  // The Devpost logo stays sharp and clickable, so the top bar is still a way home.
  keepSharpSelectors: ['#logo'],
  // The story and the "Submitted to"/"Created by" rail are siblings inside one grid;
  // isProseLike() sees enough prose to claim the whole thing and narrows it.
  disableReadingColumn: true,
}

// --- AccuWeather articles ---------------------------------------------------
// https://www.accuweather.com/en/<section>/<slug>/<id>. AccuWeather writes its own
// "further reading" citations inline in the article body as a bracket-wrapped
// sentence — e.g. "[More wildfire coverage: <a>Before-and-after images...</a> |
// <a>Check your local air quality</a>]" — with no distinguishing class name, just a
// <p class="paragraph-block"> whose text starts with "[" and ends with "]". The
// backend's link-density heuristic reads that the same as a bolted-on sidebar
// "Related Stories" widget and deemphasizes it, blurring real editorial content.
// There is no reliable CSS selector for "starts with [", so this is matched by
// text rather than by keepSharpSelectors.
const ACCUWEATHER_INLINE_CALLOUT_PATTERN = /^\[[\s\S]*\]$/

function findAccuWeatherInlineCallouts(): Element[] {
  return Array.from(document.querySelectorAll('p.paragraph-block')).filter((el) =>
    ACCUWEATHER_INLINE_CALLOUT_PATTERN.test((el.textContent || '').trim()),
  )
}

const ACCUWEATHER_ARTICLE: SiteRule = {
  name: 'accuweather-article',
  hostPattern: /(^|\.)accuweather\.com$/i,
  // /en/us/<city>/<zip>/weather-forecast/<id> (a forecast page, not an article) has
  // six path segments and never matches this four-segment shape.
  pathPattern: /^\/en\/[^/]+\/[^/]+\/\d+\/?$/i,
  confirm: () => !!document.querySelector('.news-article'),
  blurSelectors: [],
  keepSharpMatcher: findAccuWeatherInlineCallouts,
}

const SITE_RULES: SiteRule[] = [DEVPOST_PROJECT, ACCUWEATHER_ARTICLE]

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

  const matched = new Set<Element>()
  rule.blurSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      if (isVisible(el)) matched.add(el)
    })
  })

  // Several selectors deliberately overlap (the comment composer is matched by both a
  // wrapper rule and the bare `form` fallback). CSS filters compound, so a target
  // inside another target would come out blurred twice as hard — keep only the
  // outermost of each nest.
  const targets = Array.from(matched).filter(
    (el) => !Array.from(matched).some((other) => other !== el && other.contains(el)),
  )

  targets.forEach((el) => {
    saveOriginal(el)
    // The generic pass may already have dimmed this one (Devpost's #global-nav is a
    // nav, its right rail looks like a sidebar). CSS filters compound, so drop the
    // generic class rather than stacking two blurs on the same element.
    el.classList.remove(DEEMPHASIZE_CLASS)
    el.classList.add(HARD_BLUR_CLASS)
  })

  keepSharp(rule)

  return targets.length
}

// Every class that can make an ancestor take its subtree down with it: the two blurs,
// display:none from a backend 'collapse', display:none from the ad pass, and the
// unstick rules that reposition a bar out from under the content. Blur was not enough
// on its own — the top bar kept disappearing outright because the backend collapses
// site navigation at a high intensity, and clearing only the blur left it hidden.
const SUPPRESSION_CLASSES = [
  HARD_BLUR_CLASS,
  DEEMPHASIZE_CLASS,
  SECTION_HIDDEN_CLASS,
  AD_HIDDEN_CLASS,
  UNSTICK_FIXED_CLASS,
  UNSTICK_STICKY_CLASS,
]

// Walks up from each keep-sharp element clearing those classes off the whole ancestor
// chain, so nothing above it can blur or hide it by inheritance — whether that came
// from our own selectors, the generic secondary pass (which sees #global-nav as a nav),
// or a backend deemphasize/collapse. Runs after the blur pass, and applySiteRules()
// itself runs last in both simplify paths, so this is the final word.
function keepSharp(rule: SiteRule): void {
  rule.keepSharpSelectors?.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        node.classList.remove(...SUPPRESSION_CLASSES)
      }
    })
  })
  rule.keepSharpMatcher?.().forEach((el) => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      node.classList.remove(...SUPPRESSION_CLASSES)
    }
  })
}
