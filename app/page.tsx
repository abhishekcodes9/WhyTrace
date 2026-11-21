import type { Metadata } from "next";
import { LandingHero } from "@/components/landing-hero";

export const metadata: Metadata = {
  title: "Every Codebase Has a Story",
};

export default function HomePage() {
  return <LandingHero />;
}
