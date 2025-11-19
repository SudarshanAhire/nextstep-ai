"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

// Lazily get a generative model to avoid importing the SDK at module load time
async function getGenerativeModel() {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
}

// Retry helper with jittered exponential backoff
async function retryWithBackoff(fn, maxRetries = 5, initialDelayMs = 1000, maxJitterMs = 1200) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const msg = String(error?.message || "").toLowerCase();
      const isRetryable =
        msg.includes("503") ||
        msg.includes("overloaded") ||
        msg.includes("429") ||
        msg.includes("timeout") ||
        msg.includes("service unavailable");

      if (!isRetryable || attempt === maxRetries - 1) {
        throw error;
      }

      const baseDelay = initialDelayMs * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * maxJitterMs);
      const delayMs = baseDelay + jitter;
      console.log(`[retryWithBackoff][resume] Attempt ${attempt + 1} failed, retrying in ${delayMs}ms...`, {
        message: error.message,
        attempt: attempt + 1,
        baseDelay,
        jitter,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

// Local fallback: lightweight polish when AI is unavailable
function polishContentLocally(content, type) {
  // Action verbs for different resume sections
  const actionVerbs = [
    "Achieved", "Accelerated", "Built", "Created", "Delivered", "Designed", 
    "Developed", "Drove", "Enabled", "Enhanced", "Engineered", "Expanded",
    "Implemented", "Improved", "Increased", "Innovated", "Optimized", "Orchestrated",
    "Pioneered", "Scaled", "Streamlined", "Transformed", "Optimized"
  ];

  let improved = content.trim();
  
  // Remove passive voice indicators and replace with action verbs
  improved = improved.replace(/^was\s+/i, "");
  improved = improved.replace(/^were\s+/i, "");
  improved = improved.replace(/^is\s+/i, "");
  improved = improved.replace(/^are\s+/i, "");
  
  // Add action verb at the start if missing
  const startsWithVerb = /^(achieved|accelerated|built|created|delivered|designed|developed|drove|enabled|enhanced|engineered|expanded|implemented|improved|increased|innovated|optimized|orchestrated|pioneered|scaled|streamlined|transformed)/i.test(improved);
  if (!startsWithVerb && improved.length > 0) {
    const verb = actionVerbs[Math.floor(Math.random() * actionVerbs.length)];
    improved = `${verb} ${improved.charAt(0).toLowerCase()}${improved.slice(1)}`;
  }

  // Ensure it ends with period if not already
  if (!improved.endsWith(".") && !improved.endsWith("!")) {
    improved += ".";
  }

  // Capitalize first letter
  improved = improved.charAt(0).toUpperCase() + improved.slice(1);

  return improved;
}

export async function saveResume(content) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  try {
    const resume = await db.resume.upsert({
      where: {
        userId: user.id,
      },
      update: {
        content,
      },
      create: {
        userId: user.id,
        content,
      },
    });

    revalidatePath("/resume");
    return resume;
  } catch (error) {
    console.error("Error saving resume:", error);
    throw new Error("Failed to save resume");
  }
}

export async function getResume() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  return await db.resume.findUnique({
    where: {
      userId: user.id,
    },
  });
}

export async function improveWithAI({ current, type }) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
    include: {
      industryInsight: true,
    },
  });

  if (!user) throw new Error("User not found");

  const prompt = `
    As an expert resume writer, improve the following ${type} description for a ${user.industry} professional.
    Make it more impactful, quantifiable, and aligned with industry standards.
    Current content: "${current}"

    Requirements:
    1. Use action verbs
    2. Include metrics and results where possible
    3. Highlight relevant technical skills
    4. Keep it concise but detailed
    5. Focus on achievements over responsibilities
    6. Use industry-specific keywords
    
    Format the response as a single paragraph without any additional text or explanations.
  `;

  try {
    const result = await retryWithBackoff(() => getGenerativeModel().then((m) => m.generateContent(prompt)), 5, 1000, 1200);
    const resp = result?.response ?? result;

    let improvedContent = "";
    if (!resp) {
      throw new Error("No response from AI model");
    }

    if (typeof resp.text === "function") {
      improvedContent = resp.text();
    } else if (resp.candidates && resp.candidates[0]) {
      improvedContent = resp.candidates[0]?.content?.parts?.[0]?.text ?? resp.candidates[0]?.content?.text ?? "";
    } else if (resp.output?.text) {
      improvedContent = resp.output.text;
    } else {
      improvedContent = String(resp);
    }

    improvedContent = String(improvedContent).replace(/```(?:json)?\n?/g, "").trim();
    return improvedContent;
  } catch (error) {
    console.error("Error improving content with AI:", error?.message || error);
    console.log("[improveWithAI] AI service unavailable, using local fallback...");
    
    // Use local fallback when AI is unavailable
    const fallbackContent = polishContentLocally(current, type);
    console.log("[improveWithAI] Fallback improvement:", fallbackContent);
    return fallbackContent;
  }
}