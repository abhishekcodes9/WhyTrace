"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, FileSearch, GitBranch, Network, Search } from "lucide-react";
import { SpotlightSurface } from "@/components/spotlight";
import { buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const markers = [
  { icon: <GitBranch className="h-4 w-4" />, label: "GitHub history", value: "Commits · PRs · issues · ADRs" },
  { icon: <Network className="h-4 w-4" />, label: "Neo4j graph", value: "Relationships, not keyword soup" },
  { icon: <FileSearch className="h-4 w-4" />, label: "Evidence policy", value: "Facts separated from inference" },
];

export function LandingHero() {
  const reduced = useReducedMotion();
  const initial = reduced ? false : { opacity: 0, y: 16 };
  const animate = { opacity: 1, y: 0 };
  const transition = { duration: 0.62, ease: [0.16, 1, 0.3, 1] as const };

  return (
    <main className="relative flex min-h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-surface">
      <SpotlightSurface className="relative flex flex-1 items-center overflow-hidden">
        <img
          src="/noir-office.svg"
          alt="A cinematic detective office at night with a walnut desk, brass lamps, a red-thread evidence board and a rain-streaked city window"
          className="absolute inset-0 h-full w-full object-cover object-[62%_center] opacity-90"
          fetchPriority="high"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-deep-charcoal via-deep-charcoal/88 to-deep-charcoal/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-deep-charcoal via-transparent to-deep-charcoal/35" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_72%_36%,rgba(196,154,88,0.12),transparent_55%)]" />

        <div className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-44 pt-16 md:px-page-margin md:pb-28 md:pt-24">
          <div className="max-w-2xl">
            <motion.div initial={initial} animate={animate} transition={{ ...transition, delay: 0.04 }} className="mb-6 flex items-center gap-3">
              <span className="h-px w-10 bg-primary/70" aria-hidden="true" />
              <span className="font-label text-label-md uppercase tracking-[0.22em] text-primary">Engineering history, investigated</span>
            </motion.div>

            <motion.h1
              initial={initial}
              animate={animate}
              transition={{ ...transition, delay: 0.1 }}
              className="text-balance font-display text-[42px] font-semibold leading-[46px] tracking-[-0.5px] text-on-surface sm:text-[54px] sm:leading-[58px] lg:text-display-lg"
            >
              Every Codebase
              <br />
              Has a Story.
            </motion.h1>

            <motion.p
              initial={initial}
              animate={animate}
              transition={{ ...transition, delay: 0.18 }}
              className="mt-6 max-w-xl text-pretty font-body text-body-lg text-on-surface-variant"
            >
              Investigate your codebase. Follow its history. Discover why it exists.
            </motion.p>

            <motion.div
              initial={initial}
              animate={animate}
              transition={{ ...transition, delay: 0.26 }}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <Link href="/connect" className={buttonClasses("primary", "lg")}>
                <Search className="h-4 w-4" aria-hidden="true" />
                Start Investigation
              </Link>
              <Link href="/report/demo" className={buttonClasses("secondary", "lg")}>
                Explore Demo
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </motion.div>

            <motion.div
              initial={initial}
              animate={animate}
              transition={{ ...transition, delay: 0.34 }}
              className="mt-6 flex flex-wrap items-center gap-2"
            >
              <Badge variant="neutral">Demo case is synthetic</Badge>
              <span className="font-body text-body-sm text-on-surface-variant/80">
                Bring any accessible GitHub repository to begin a real investigation.
              </span>
            </motion.div>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 z-10 border-t border-primary/15 bg-deep-charcoal/55 backdrop-blur-[2px]">
          <div className="mx-auto grid max-w-7xl grid-cols-1 divide-y divide-outline-variant/60 px-4 sm:grid-cols-3 sm:divide-x sm:divide-y-0 md:px-page-margin">
            {markers.map((marker) => (
              <div key={marker.label} className="flex items-center gap-3 px-0 py-4 sm:px-5 first:sm:pl-0 last:sm:pr-0">
                <span className="text-primary/80">{marker.icon}</span>
                <div>
                  <p className="font-label text-[10px] uppercase tracking-[0.14em] text-on-surface-variant">{marker.label}</p>
                  <p className="font-mono text-mono-sm text-on-surface">{marker.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SpotlightSurface>
    </main>
  );
}
