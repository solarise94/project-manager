import type { ChatProvider, VisionProvider, SearchProvider, SpeechProvider } from "./types";
import { MinimaxChatProvider } from "./minimax-chat";
import { MinimaxVisionProvider } from "./minimax-vision";
import { MinimaxSearchProvider } from "./minimax-search";
import { TencentAsrProvider } from "./tencent-asr";

export function getChatProvider(): ChatProvider {
  return new MinimaxChatProvider();
}

export function getVisionProvider(): VisionProvider {
  return new MinimaxVisionProvider();
}

export function getSearchProvider(): SearchProvider {
  return new MinimaxSearchProvider();
}

export function getSpeechProvider(): SpeechProvider {
  return new TencentAsrProvider();
}

export function isDraftAIConfigured(): boolean {
  return !!(process.env.MINIMAX_API_KEY);
}

export function isAsrConfigured(): boolean {
  return !!(process.env.TENCENTCLOUD_SECRET_ID && process.env.TENCENTCLOUD_SECRET_KEY);
}
