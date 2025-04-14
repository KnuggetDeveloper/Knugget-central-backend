// src/services/generateSummary.ts
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

// Check for API key and provide helpful error message if missing
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("ERROR: Missing OPENAI_API_KEY in environment variables");
}

// Initialize the OpenAI client with better error handling
let openai: OpenAI;
try {
  openai = new OpenAI({
    apiKey: OPENAI_API_KEY
  });
} catch (error) {
  console.error("Failed to initialize OpenAI client:", error);
  // Create a placeholder that will throw a helpful error if used
  openai = {
    chat: {
      completions: {
        create: () => {
          throw new Error("OpenAI API not properly configured");
        }
      }
    }
  } as unknown as OpenAI;
}

/**
 * Generate a high-quality summary from a video transcript using OpenAI
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
    // Skip API call if transcript is too short
    if (transcript.length < 100) {
      throw new Error("Transcript is too short to generate a meaningful summary");
    }

    // Prepare the model parameters
    const model = "gpt-3.5-turbo"; // Use gpt-4 if you need higher quality summaries

    // Prepare the prompt for comprehensive summary generation
    const prompt = `
You are an AI video summarization expert. Create a detailed, informative summary of the following video transcript.

VIDEO TITLE: ${title}

TRANSCRIPT:
${transcript.slice(0, 14000)} 
${transcript.length > 14000 ? "... [transcript truncated due to length]" : ""}

Please provide:
1. A concise but comprehensive summary paragraph of the main topics covered (200-300 words)
2. 5-8 key bullet points capturing the most important information, insights or takeaways

Format your response exactly like this:

SUMMARY:
[Your comprehensive summary paragraph here]

KEY POINTS:
- [Key point 1]
- [Key point 2]
- [Key point 3]
- [Additional key points as needed]

Make the summary informative, well-structured, and focused on the main content of the video. 
Each key point should be a complete thought, 1-2 sentences long.
`;

    // Generate content from OpenAI
    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content: "You are an expert at summarizing video content and extracting key points."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.5, // Lower temperature for more focused responses
      max_tokens: 2048, // Adjust as needed
    });

    // Get the response text
    const text = response.choices[0]?.message?.content || "";
    if (!text) {
      throw new Error("No text generated from OpenAI");
    }

    // Log the raw response for debugging
    console.log("Raw OpenAI response:", text.substring(0, 200) + "...");

    // Parse the response to extract summary and key points
    let fullSummary = "";
    let keyPoints: string[] = [];

    if (text.includes("SUMMARY:") && text.includes("KEY POINTS:")) {
      const summaryMatch = text.match(/SUMMARY:([\s\S]*?)KEY POINTS:/);
      if (summaryMatch && summaryMatch[1]) {
        fullSummary = summaryMatch[1].trim();
      }

      const keyPointsSection = text.split("KEY POINTS:")[1];
      if (keyPointsSection) {
        keyPoints = keyPointsSection
          .split(/\n-\s*/)
          .map(point => point.trim())
          .filter(point => point.length > 0);
        
        // Clean up the first item which might contain a newline or dash
        if (keyPoints.length > 0) {
          keyPoints[0] = keyPoints[0].replace(/^[-\s]*/, '');
        }
      }
    } else {
      // Fallback parsing if format doesn't match exactly
      const lines = text.split('\n').filter(line => line.trim().length > 0);
      
      // If no clear structure, try to separate the first paragraph as summary
      // and the rest as bullet points
      if (lines.length > 1) {
        fullSummary = lines[0];
        keyPoints = lines.slice(1).map(line => 
          line.replace(/^[-•*]\s*/, '')  // Remove bullet markers
        );
      } else {
        fullSummary = text;
      }
    }

    // Make sure we have content in both fields
    if (!fullSummary) {
      fullSummary = "Summary could not be extracted from the generated content.";
    }

    if (keyPoints.length === 0) {
      // If no key points were successfully extracted, generate some from the summary
      keyPoints = fullSummary
        .split(/[.!?]+/)
        .map(s => s.trim())
        .filter(s => s.length > 15 && s.length < 150)
        .slice(0, 5);
    }

    // Add emojis to key points for better visual presentation
    const emojis = ["🔑", "💡", "📌", "✨", "🔍", "📊", "🧠", "🎯"];
    keyPoints = keyPoints.map((point, index) => {
      const emoji = emojis[index % emojis.length];
      return `${emoji} ${point}`;
    });

    // Add emoji to summary
    fullSummary = `🧠 **Summary:**\n${fullSummary}`;

    return {
      title,
      keyPoints,
      fullSummary,
    };
  } catch (error) {
    console.error("Error generating summary with OpenAI:", error);

    // Fallback to simpler summary generation if API fails
    try {
      console.log("Using fallback summary generation method");
      
      // Extract sentences from transcript
      const sentences = transcript
        .split(/[.!?]+/)
        .filter((s) => s.trim().length > 20);

      // Select a few key sentences as key points (more than in original function)
      let keyPoints = sentences
        .slice(0, Math.min(8, sentences.length))
        .map((s) => s.trim())
        .filter((s, i, arr) => arr.indexOf(s) === i); // Remove duplicates

      // Add emojis to key points
      const emojis = ["🔑", "💡", "📌", "✨", "🔍", "📊", "🧠", "🎯"];
      keyPoints = keyPoints.map((point, index) => {
        const emoji = emojis[index % emojis.length];
        return `${emoji} ${point}`;
      });

      // Create a more detailed summary paragraph
      const topSentences = sentences.slice(0, Math.min(10, sentences.length)).join(". ");
      const fullSummary = `🧠 **Summary:**\n${topSentences || "Summary not available."}`;

      return {
        title,
        keyPoints: keyPoints.length > 0 ? keyPoints : [],
        fullSummary,
      };
    } catch (fallbackError) {
      console.error("Fallback summary generation also failed:", fallbackError);
      
      // Return a graceful failure
      return {
        title,
        keyPoints: ["📌 Unable to generate key points for this video."], 
        fullSummary: "🧠 **Summary:**\nSorry, we couldn't generate a summary for this video at this time.",
      };
    }
  }
};