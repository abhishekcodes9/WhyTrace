import { describe, expect, it } from "vitest";
import { parseGitHubRepoUrl, RepoUrlError, isValidRepositoryFullName, isValidBranch } from "@/lib/validation";
import { escapeLucene, keywords, confidenceLabel, shortSha, truncate, cleanText } from "@/lib/utils";

describe("GitHub repository URL parsing", () => {
  it("accepts canonical repository URLs", () => {
    expect(parseGitHubRepoUrl("https://github.com/octocat/Hello-World")).toEqual({
      owner: "octocat",
      name: "Hello-World",
      fullName: "octocat/Hello-World",
      canonicalUrl: "https://github.com/octocat/Hello-World",
    });
    expect(parseGitHubRepoUrl("https://www.github.com/vercel/next.js/").fullName).toBe("vercel/next.js");
    expect(parseGitHubRepoUrl("https://github.com/owner/repo.git").name).toBe("repo");
  });

  it("rejects non-GitHub hosts, credentials and deep paths", () => {
    expect(() => parseGitHubRepoUrl("https://gitlab.com/owner/repo")).toThrowError(RepoUrlError);
    expect(() => parseGitHubRepoUrl("https://github.com/owner/repo/tree/main")).toThrowError(RepoUrlError);
    expect(() => parseGitHubRepoUrl("https://user:pass@github.com/owner/repo")).toThrowError(RepoUrlError);
    expect(() => parseGitHubRepoUrl("javascript:alert(1)")).toThrowError(RepoUrlError);
    expect(() => parseGitHubRepoUrl("")).toThrowError(RepoUrlError);
  });

  it("validates repository identities and branch names", () => {
    expect(isValidRepositoryFullName("owner/repo")).toBe(true);
    expect(isValidRepositoryFullName("../repo")).toBe(false);
    expect(isValidRepositoryFullName("owner/repo/extra")).toBe(false);
    expect(isValidBranch("feature/auth")).toBe(true);
    expect(isValidBranch("../main")).toBe(false);
    expect(isValidBranch("feature//auth")).toBe(true);
  });
});

describe("query and text utilities", () => {
  it("removes stopwords and duplicates", () => {
    expect(keywords("Why was this function introduced in the router cache?")).toEqual(["router", "cache"]);
  });

  it("escapes Lucene syntax", () => {
    expect(escapeLucene("auth+(token):*")).toBe("auth token");
  });

  it("maps confidence deterministically", () => {
    expect(confidenceLabel(90)).toBe("high");
    expect(confidenceLabel(50)).toBe("medium");
    expect(confidenceLabel(25)).toBe("low");
    expect(confidenceLabel(3)).toBe("insufficient");
  });

  it("formats metadata safely", () => {
    expect(shortSha("8f3a91c000000000000000000000000000000000")).toBe("8f3a91c");
    expect(truncate("a".repeat(50), 10)).toHaveLength(11);
    expect(cleanText("<script>alert(1)</script>Hello")).toBe("Hello");
  });
});
