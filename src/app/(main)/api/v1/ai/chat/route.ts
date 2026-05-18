import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Mock responses for different query types
const MOCK_RESPONSES: Record<string, string> = {
  leads:
    "Based on your CRM data, you currently have leads in various stages of your pipeline. You can view all leads in the 'All Leads' section or see them organized by stage in the 'Pipeline' view.",
  pipeline:
    "Your pipeline shows leads organized by stages. You can drag and drop leads between stages to update their status. Each stage represents a step in your sales process.",
  help: "I can help you with:\n\n• Finding specific leads by name or email\n• Understanding your pipeline stages\n• Explaining CRM features\n• Providing tips for lead management\n\nJust ask me anything!",
  export:
    "You can export your leads to CSV from both the 'All Leads' table and the 'Pipeline' view. Look for the 'Export' button in the toolbar.",
  default:
    "I understand you're asking about your CRM. While I'm still learning about your specific data, I can help you navigate the system and answer general questions. Could you be more specific about what you'd like to know?",
};

function generateMockResponse(message: string): string {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("lead") || lowerMessage.includes("contact")) {
    return MOCK_RESPONSES.leads;
  }
  if (lowerMessage.includes("pipeline") || lowerMessage.includes("stage")) {
    return MOCK_RESPONSES.pipeline;
  }
  if (lowerMessage.includes("help") || lowerMessage.includes("what can you")) {
    return MOCK_RESPONSES.help;
  }
  if (lowerMessage.includes("export") || lowerMessage.includes("csv")) {
    return MOCK_RESPONSES.export;
  }

  // Greeting responses
  if (
    lowerMessage.includes("hello") ||
    lowerMessage.includes("hi") ||
    lowerMessage.includes("hey")
  ) {
    return "Hello! How can I assist you with your CRM today?";
  }

  // Thank you responses
  if (lowerMessage.includes("thank")) {
    return "You're welcome! Let me know if there's anything else I can help you with.";
  }

  return MOCK_RESPONSES.default;
}

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { message: "Unauthorized" } },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { message } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: { message: "Message is required" } },
        { status: 400 }
      );
    }

    // Simulate AI thinking time (300-800ms)
    await new Promise((resolve) =>
      setTimeout(resolve, 300 + Math.random() * 500)
    );

    // Generate mock response
    const response = generateMockResponse(message);

    return NextResponse.json({
      response,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("AI Chat error:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
