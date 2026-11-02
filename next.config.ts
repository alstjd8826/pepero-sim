import type { NextConfig } from "next";
import { HTML_LIMITED_BOT_UA_RE } from "next/dist/shared/lib/router/utils/html-bots";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // 링크 미리보기 봇에는 메타데이터를 스트리밍하지 않고 <head> 안에 넣어 보낸다.
  // Next 기본 목록에 카카오톡 스크래퍼가 없어서 추가한다(UA: "... kakaotalk-scrap/1.0 ...").
  htmlLimitedBots: new RegExp(`${HTML_LIMITED_BOT_UA_RE.source}|kakaotalk-scrap|Daum|naver`, "i"),
};

export default nextConfig;
