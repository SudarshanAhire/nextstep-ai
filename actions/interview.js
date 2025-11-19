"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Helper function to retry with jittered exponential backoff
async function retryWithBackoff(fn, maxRetries = 5, initialDelayMs = 1000, maxJitterMs = 1000) {
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

      // Exponential backoff with jitter
      const baseDelay = initialDelayMs * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * maxJitterMs);
      const delayMs = baseDelay + jitter;
      console.log(`[retryWithBackoff] Attempt ${attempt + 1} failed, retrying in ${delayMs}ms...`, {
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

export async function generateQuiz() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
    select: {
      industry: true,
      skills: true,
    },
  });

  if (!user) throw new Error("User not found");

  console.log(`[generateQuiz] Generating quiz for user industry: ${user.industry}, skills: ${JSON.stringify(user.skills)}`);

  const prompt = `
    Generate 10 technical interview questions for a ${
      user.industry
    } professional${
    user.skills?.length ? ` with expertise in ${user.skills.join(", ")}` : ""
  }.
    
    Each question should be multiple choice with 4 options.
    
    Return the response in this JSON format only, no additional text:
    {
      "questions": [
        {
          "question": "string",
          "options": ["string", "string", "string", "string"],
          "correctAnswer": "string",
          "explanation": "string"
        }
      ]
    }
  `;

  try {
    const result = await retryWithBackoff(() => model.generateContent(prompt), 5, 1000, 1200);
    console.log("[generateQuiz] Received AI response, type:", typeof result);

    // Support multiple response shapes and be defensive
    const response = result?.response ?? result;
    let text = "";

    if (!response) {
      throw new Error("No response from AI model");
    }

    if (typeof response.text === "function") {
      text = response.text();
    } else if (response.candidates && response.candidates[0]) {
      const cand = response.candidates[0];
      text = cand?.content?.parts?.[0]?.text ?? cand?.content?.text ?? "";
    } else if (response.output?.text) {
      text = response.output.text;
    } else {
      text = JSON.stringify(response);
    }

    console.log("[generateQuiz] Extracted text (first 200 chars):", text.substring(0, 200));
    const cleanedText = String(text).replace(/```(?:json)?\n?/g, "").trim();

    let quiz;
    try {
      quiz = JSON.parse(cleanedText);
      console.log("[generateQuiz] Successfully parsed JSON, questions count:", quiz.questions?.length);
    } catch (err) {
      console.error("Failed to parse quiz JSON from AI response:", cleanedText.substring(0, 500), err.message);
      throw new Error("Failed to parse quiz questions from AI response");
    }

    if (!quiz || !Array.isArray(quiz.questions)) {
      console.error("Invalid quiz structure from AI:", quiz);
      throw new Error("Invalid quiz structure returned by AI");
    }

    console.log("[generateQuiz] Returning", quiz.questions.length, "questions");
    return quiz.questions;
  } catch (error) {
    console.error("Error generating quiz:", error.message, error.stack);
    throw new Error("Failed to generate quiz questions: " + error.message);
  }
}

export async function saveQuizResult(questions, answers, score) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  console.log(`[saveQuizResult] Saving quiz for user ${user.id}, score: ${score}, questions: ${questions?.length}`);

  const questionResults = questions.map((q, index) => ({
    question: q.question,
    answer: q.correctAnswer,
    userAnswer: answers[index],
    isCorrect: q.correctAnswer === answers[index],
    explanation: q.explanation,
  }));

  console.log(`[saveQuizResult] Created ${questionResults.length} question results`);

  // Get wrong answers
  const wrongAnswers = questionResults.filter((q) => !q.isCorrect);
  console.log(`[saveQuizResult] Wrong answers: ${wrongAnswers.length}`);

  // Only generate improvement tips if there are wrong answers
  let improvementTip = null;
  if (wrongAnswers.length > 0) {
    const wrongQuestionsText = wrongAnswers
      .map(
        (q) =>
          `Question: "${q.question}"\nCorrect Answer: "${q.answer}"\nUser Answer: "${q.userAnswer}"`
      )
      .join("\n\n");

    const improvementPrompt = `
      The user got the following ${user.industry} technical interview questions wrong:

      ${wrongQuestionsText}

      Based on these mistakes, provide a concise, specific improvement tip.
      Focus on the knowledge gaps revealed by these wrong answers.
      Keep the response under 2 sentences and make it encouraging.
      Don't explicitly mention the mistakes, instead focus on what to learn/practice.
    `;

    try {
      console.log("[saveQuizResult] Generating improvement tip...");
      const tipResult = await retryWithBackoff(() => model.generateContent(improvementPrompt), 5, 1000, 1200);

      const tipResp = tipResult?.response ?? tipResult;
      let tipText = "";

      if (tipResp) {
        if (typeof tipResp.text === "function") {
          tipText = tipResp.text();
        } else if (tipResp.candidates && tipResp.candidates[0]) {
          tipText = tipResp.candidates[0]?.content?.parts?.[0]?.text ?? tipResp.candidates[0]?.content?.text ?? "";
        } else if (tipResp.output?.text) {
          tipText = tipResp.output.text;
        } else {
          tipText = JSON.stringify(tipResp);
        }
      }

      improvementTip = String(tipText).replace(/```(?:json)?\n?/g, "").trim();
      console.log("Generated improvement tip:", improvementTip);
    } catch (error) {
      console.error("Error generating improvement tip:", error.message);
      // Continue without improvement tip if generation fails
    }
  }

  try {
    console.log("[saveQuizResult] Creating assessment in database...");
    const assessment = await db.assessment.create({
      data: {
        userId: user.id,
        quizScore: score,
        questions: questionResults,
        category: "Technical",
        improvementTip,
      },
    });

    console.log("[saveQuizResult] Assessment created successfully, ID:", assessment.id);
    return assessment;
  } catch (error) {
    console.error("Error saving quiz result:", error.message, error.stack);
    throw new Error("Failed to save quiz result: " + error.message);
  }
}

export async function getAssessments() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  try {
    const assessments = await db.assessment.findMany({
      where: {
        userId: user.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return assessments;
  } catch (error) {
    console.error("Error fetching assessments:", error);
    throw new Error("Failed to fetch assessments");
  }
}