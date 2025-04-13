// src/services/generateSummary.ts
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

// Check for API key and provide helpful error message if missing
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("ERROR: Missing GEMINI_API_KEY in environment variables");
}

// Initialize the Google Generative AI client with better error handling
let genAI: GoogleGenerativeAI;
try {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY || "");
} catch (error) {
  console.error("Failed to initialize Google Generative AI client:", error);
  // Create a placeholder that will throw a helpful error if used
  genAI = {
    getGenerativeModel: () => {
      throw new Error("Google AI API not properly configured");
    },
  } as unknown as GoogleGenerativeAI;
}

/**
 * Generate a summary from a video transcript
 * @param transcript The video transcript text
 * @param metadata Video metadata including title, videoId, etc.
 * @returns Object containing title, key points, and full summary
 */
export const generateSummary = async (
  transcript: string,
  metadata: any
): Promise<{
  title: string;
  keyPoints: string[];
  fullSummary: string;
}> => {
  // Get title from metadata or use a default
  const title = metadata?.title || "Video Summary";

  try {
    // Extract sentences from transcript
    const sentences = transcript
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 20);

    // Select a few key sentences as key points
    const keyPoints = sentences
      .slice(0, Math.min(5, sentences.length))
      .map((s) => s.trim())
      .filter((s, i, arr) => arr.indexOf(s) === i); // Remove duplicates

    // Create a simple summary paragraph
    const summary = `This video discusses ${keyPoints.join(
      ". It also covers "
    )}`;

    return {
      title,
      keyPoints: keyPoints.length > 0 ? keyPoints : [],
      fullSummary: summary || "Summary generation failed. Please try again.",
    };
  } catch (error) {
    console.error("Error generating summary:", error);

    // Return a graceful failure
    return {
      title,
      keyPoints: [], // Empty array instead of null or undefined
      fullSummary:
        "Sorry, we couldn't generate a summary for this video at this time.",
    };
  }
};
