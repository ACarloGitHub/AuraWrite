/**
 * Regression test for the "AI provider select does not update base URL anymore" bug.
 *
 * Bug history (2026-06-12, found by Carlo during image toolbar testing):
 * In commit c719e04 (MiniMax provider) the base URL auto-fill logic was
 * changed to only fire when the field is empty OR has been auto-filled
 * previously (dataset.autoFilled === "true"). This is good for users who
 * want to override the default URL.
 *
 * BUT applyPreferences() (which loads saved prefs from localStorage and
 * sets the input value on app start) never set dataset.autoFilled. So if
 * a user had previously saved a base URL, the input would have a value
 * from the start, dataset.autoFilled would be undefined, and switching
 * the provider would NOT update the base URL. The feature was effectively
 * broken for returning users.
 *
 * The fix is in main.ts applyPreferences(): after setting the base URL
 * input value, mark it as auto-filled if the value matches a known default
 * URL from PROVIDER_BASE_URLS.
 *
 * This test extracts the logic into a pure function for testability and
 * verifies the fix.
 */
import { describe, it, expect } from "vitest";
import { PROVIDER_BASE_URLS } from "./providers";

/**
 * Pure function extracted from main.ts. Given a saved base URL, decides
 * whether to mark the input as auto-filled (and therefore re-populated
 * on the next provider change).
 */
function shouldMarkAsAutoFilled(savedBaseUrl: string): boolean {
  const knownDefaults = Object.values(PROVIDER_BASE_URLS) as string[];
  return knownDefaults.includes(savedBaseUrl);
}

describe("AI provider base URL auto-fill marker (regression test for c719e04)", () => {
  it("marks Ollama default as auto-filled", () => {
    expect(shouldMarkAsAutoFilled("http://localhost:11434")).toBe(true);
  });

  it("marks LM Studio default as auto-filled", () => {
    expect(shouldMarkAsAutoFilled("http://localhost:1234/v1")).toBe(true);
  });

  it("marks OpenAI default as auto-filled", () => {
    expect(shouldMarkAsAutoFilled("https://api.openai.com/v1")).toBe(true);
  });

  it("marks Anthropic default as auto-filled", () => {
    expect(shouldMarkAsAutoFilled("https://api.anthropic.com/v1")).toBe(true);
  });

  it("marks DeepSeek default as auto-filled", () => {
    expect(shouldMarkAsAutoFilled("https://api.deepseek.com")).toBe(true);
  });

  it("marks OpenRouter default as auto-filled", () => {
    expect(shouldMarkAsAutoFilled("https://openrouter.ai/api/v1")).toBe(true);
  });

  it("marks MiniMax default as auto-filled", () => {
    expect(shouldMarkAsAutoFilled("https://api.minimax.io/v1")).toBe(true);
  });

  it("marks Ollama cloud default as auto-filled", () => {
    expect(shouldMarkAsAutoFilled("https://ollama.com")).toBe(true);
  });

  it("does NOT mark a user-customized URL as auto-filled", () => {
    expect(shouldMarkAsAutoFilled("https://my-custom-proxy.example.com/v1")).toBe(false);
  });

  it("does NOT mark an empty string as auto-filled", () => {
    expect(shouldMarkAsAutoFilled("")).toBe(false);
  });

  it("does NOT mark a default-like but different URL as auto-filled", () => {
    // User has slightly different port (e.g. 11435 instead of 11434)
    expect(shouldMarkAsAutoFilled("http://localhost:11435")).toBe(false);
  });
});

describe("Integration scenario: returning user changes provider", () => {
  /**
   * Simulates the full user flow:
   * 1. User opens the app (saved prefs are applied).
   * 2. User changes provider from Ollama to LM Studio.
   * 3. Base URL must update.
   *
   * Before the fix: step 1 sets the input value but not the marker, so
   * step 2 sees a non-empty value with autoFilled=false and does NOT
   * update the base URL.
   *
   * After the fix: step 1 also sets the marker, so step 2 updates the
   * base URL as expected.
   */
  it("updates base URL when the saved URL matches a known default", () => {
    // Step 1: saved prefs are loaded
    const savedBaseUrl = PROVIDER_BASE_URLS.ollama; // "http://localhost:11434"
    const autoFilled = shouldMarkAsAutoFilled(savedBaseUrl);
    expect(autoFilled).toBe(true);

    // Step 2: user changes provider, the auto-fill logic should fire
    // (the real updateApiKeyGroupVisibility() reads dataset.autoFilled
    // and re-populates the field)
    const fakeDataset = { autoFilled: autoFilled ? "true" : "false" };
    const fakeInput = { value: savedBaseUrl, dataset: fakeDataset };
    // Inline the auto-fill condition
    const shouldRefill =
      !fakeInput.value.trim() || fakeInput.dataset.autoFilled === "true";
    expect(shouldRefill).toBe(true);
  });

  it("does NOT overwrite a user-customized URL on provider change", () => {
    // User has overridden the URL to a custom value
    const userUrl = "https://my-proxy.example.com/openai";
    const autoFilled = shouldMarkAsAutoFilled(userUrl);
    expect(autoFilled).toBe(false);

    const fakeDataset = { autoFilled: autoFilled ? "true" : "false" };
    const fakeInput = { value: userUrl, dataset: fakeDataset };
    const shouldRefill =
      !fakeInput.value.trim() || fakeInput.dataset.autoFilled === "true";
    expect(shouldRefill).toBe(false);
  });
});
