const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const compression = require("compression");
const levenshtein = require("fast-levenshtein");
const axios = require("axios"); // axios 추가
require("dotenv").config();


const app = express();

// 미들웨어 설정
app.use(cors());
app.use(compression());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// JSON 파일 로드 (예: ./json/companyData.json)
const companyData = JSON.parse(fs.readFileSync("./json/companyData.json", "utf-8"));








app.post("/chat", async (req, res) => {
  const userInput = req.body.message;
  if (!userInput) {
    return res.status(400).json({ error: "Message is required" });
  }
  try {
    const answer = await findAnswer(userInput);
    if (answer.text === "질문을 이해하지 못했어요. 좀더 자세히 입력 해주시겠어요") {
      const gptResponse = await getGPT3TurboResponse(userInput);
      return res.json({
        text: gptResponse,
        videoHtml: null,
        description: null,
        imageUrl: null
      });
    }
    return res.json(answer);
  } catch (error) {
    console.error("Error in /chat endpoint:", error.message);
    return res.status(500).json({
      text: "죄송하지만, 현재 요청을 처리할 수 없습니다. 나중에 다시 시도해 주세요.",
      videoHtml: null,
      description: null,
      imageUrl: null
    });
  }
});



/**
 * 전역 상태: 커버링 컨텍스트 여부  
 * 실제 서비스에서는 사용자별 세션으로 관리하는 것이 안전합니다.
 */
let pendingCoveringContext = false;

/**
 * 입력 문장을 정규화하는 함수  
 * - 구두점 제거, "없나요" → "없어요" 등 통일
 */
function normalizeSentence(sentence) {
  return sentence
    .replace(/[?!！？]/g, "")
    .replace(/없나요/g, "없어요")
    .trim();
}

/**
 * 비즈 관련 추가 자연어 코멘트를 랜덤 선택하는 함수
 */
function getAdditionalBizComment() {
  const comments = [
    "추가로 궁금하신 사항이 있으시면 언제든 말씀해주세요.",
    "이 정보가 도움이 되길 바랍니다.",
    "더 자세한 정보가 필요하시면 문의해 주세요.",
    "고객님의 선택에 도움이 되었으면 좋겠습니다."
  ];
  return comments[Math.floor(Math.random() * comments.length)];
}

/**
 * history 내용을 간략하게 요약하는 함수 (maxLength 길이까지 자름)
 */
function summarizeHistory(text, maxLength = 300) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

/**
 * 사용자 입력과 가장 유사한 질문을 찾아 답변을 반환하는 함수  
 * 반환 객체에는 text, videoHtml, description, imageUrl 필드가 포함됨
 */
async function findAnswer(userInput) {
  const normalizedUserInput = normalizeSentence(userInput);

  // =========================
  // [0] 커버링 컨텍스트가 활성화되어 있다면, 우선 커버링 로직부터 처리
  // =========================
  if (pendingCoveringContext) {
    const coveringTypes = ["더블", "맥스", "프라임", "슬림", "미디", "미니", "팟", "드롭", "라운저", "피라미드"];
    if (coveringTypes.includes(normalizedUserInput)) {
      const key = `${normalizedUserInput} 커버링 방법을 알고 싶어`;
      if (companyData.covering && companyData.covering[key]) {
        const videoUrl = companyData.covering[key].videoUrl;
        pendingCoveringContext = false; // 사용 후 해제
        return {
          text: companyData.covering[key].answer,
          videoHtml: videoUrl
            ? `<iframe width="560" height="315" src="${videoUrl}" frameborder="0" allowfullscreen></iframe>`
            : null,
          description: null,
          imageUrl: null
        };
      }
      pendingCoveringContext = false;
    }
  }

  // =========================
  // Step 1: 사이즈 관련 조건
  // =========================
  if (
    normalizedUserInput.includes("소파 사이즈") ||
    normalizedUserInput.includes("빈백 사이즈") ||
    normalizedUserInput.includes("상품 사이즈")
  ) {
    return {
      text: "어떤 빈백 사이즈가 궁금하신가요? 예를 들어, 맥스, 더블, 프라임, 피라미드 등 상품명을 입력해주세요.",
      videoHtml: null,
      description: null,
      imageUrl: null
    };
  }
  const sizeTypes = ["더블", "맥스", "프라임", "슬림", "미디", "미니", "팟", "드롭", "라운저", "피라미드"];
  for (let sizeType of sizeTypes) {
    if (normalizedUserInput.includes(sizeType)) {
      const key = sizeType + " 사이즈 또는 크기.";
      if (companyData.sizeInfo && companyData.sizeInfo[key]) {
        return {
          text: companyData.sizeInfo[key].description,
          videoHtml: null,
          description: companyData.sizeInfo[key].description,
          imageUrl: companyData.sizeInfo[key].imageUrl
        };
      }
    }
  }

  // =========================
  // Step 2: 제품 커버 관련 조건 (교체/사용 관련)
  // =========================
  if (
    normalizedUserInput.includes("커버") &&
    normalizedUserInput.includes("교체") &&
    (normalizedUserInput.includes("사용") || normalizedUserInput.includes("교체해서 사용"))
  ) {
    return {
      text:
        "해당 제품 전용 커버라면 모두 사용 가능해요. 요기보, 럭스, 믹스, 줄라 등 다양한 커버를 사용해보세요. 예를 들어, 맥스 제품을 사용 중이시라면 요기보 맥스 커버, 럭스 맥스 커버, 믹스 맥스 커버, 줄라 맥스 커버로 교체하여 사용 가능합니다.",
      videoHtml: null,
      description: null,
      imageUrl: null
    };
  }

  // =========================
  // Step 3: 커버링 관련 조건
  // =========================
  const coveringTypes2 = ["더블", "맥스", "프라임", "슬림", "미디", "미니", "팟", "드롭", "라운저", "피라미드"];
  if (
    normalizedUserInput.includes("커버링") &&
    normalizedUserInput.includes("방법") &&
    !coveringTypes2.some((type) => normalizedUserInput.includes(type))
  ) {
    pendingCoveringContext = true;
    return {
      text: "어떤 커버링인가요? 예를 들어, '맥스', '프라임', '더블', '피라미드' 등을 입력해주세요.",
      videoHtml: null,
      description: null,
      imageUrl: null
    };
  }
  if (normalizedUserInput === "커버링 방법 알려줘") {
    pendingCoveringContext = true;
    return {
      text: "어떤 커버링인가요? 예를 들어, '맥스', '프라임', '더블', '피라미드' 등을 입력해주세요.",
      videoHtml: null,
      description: null,
      imageUrl: null
    };
  }

  // =========================
  // Step 4: 비즈 관련 조건
  // =========================
  const bizTypes = ["프리미엄 플러스", "프리미엄", "스탠다드"];
  if (normalizedUserInput.includes("비즈") && !bizTypes.some((type) => normalizedUserInput.includes(type))) {
    return {
      text: "어떤 비즈에 대해 궁금하신가요? 예를 들어, '스탠다드 비즈', '프리미엄 비즈', '프리미엄 플러스 비즈' 등을 입력해주세요.",
      videoHtml: null,
      description: null,
      imageUrl: null
    };
  }
  if (normalizedUserInput === "비즈 알려줘" || normalizedUserInput === "비즈 방법 알려줘") {
    return {
      text: "어떤 비즈에 대해 궁금하신가요? 예를 들어, '스탠다드 비즈', '프리미엄 비즈', '프리미엄 플러스 비즈' 등을 입력해주세요.",
      videoHtml: null,
      description: null,
      imageUrl: null
    };
  }
  if (bizTypes.includes(normalizedUserInput)) {
    const key = `${normalizedUserInput} 비즈 에 대해 알고 싶어`;
    if (companyData.biz && companyData.biz[key]) {
      return {
        text: companyData.biz[key].description + " " + getAdditionalBizComment(),
        videoHtml: null,
        description: companyData.biz[key].description,
        imageUrl: null
      };
    }
  }
  for (let bizType of bizTypes) {
    if (normalizedUserInput.includes(bizType)) {
      const key = `${bizType} 비즈 에 대해 알고 싶어`;
      if (companyData.biz && companyData.biz[key]) {
        return {
          text: companyData.biz[key].description + " " + getAdditionalBizComment(),
          videoHtml: null,
          description: companyData.biz[key].description,
          imageUrl: null
        };
      }
    }
  }

  // =========================
  // Step 5: 요기보 history 관련 조건
  // =========================
  if (
    normalizedUserInput.includes("요기보") &&
    (normalizedUserInput.includes("역사") ||
      normalizedUserInput.includes("알려줘") ||
      normalizedUserInput.includes("란") ||
      normalizedUserInput.includes("탄생") ||
      normalizedUserInput.includes("에 대해"))
  ) {
    const key = "요기보 에 대해 알고 싶어";
    if (companyData.history && companyData.history[key]) {
      const fullHistory = companyData.history[key].description;
      const summary = summarizeHistory(fullHistory, 300);
      return {
        text: summary,
        videoHtml: null,
        description: fullHistory,
        imageUrl: null
      };
    }
  }

  // =========================
  // Step 6: 제품 정보(goodsInfo) 관련 조건 - Levenshte인
  // =========================
  let bestGoodsMatch = null;
  let bestGoodsDistance = Infinity;
  if (companyData.goodsInfo) {
    for (let question in companyData.goodsInfo) {
      const normalizedQuestion = normalizeSentence(question);
      const distance = levenshtein.get(normalizedUserInput, normalizedQuestion);
      if (distance < bestGoodsDistance) {
        bestGoodsDistance = distance;
        bestGoodsMatch = companyData.goodsInfo[question];
      }
    }
  }
  const goodsThreshold = 8;
  if (bestGoodsMatch && bestGoodsDistance <= goodsThreshold) {
    return {
      text: bestGoodsMatch.description,
      videoHtml: null,
      description: bestGoodsMatch.description,
      imageUrl: bestGoodsMatch.imageUrl ? bestGoodsMatch.imageUrl : null
    };
  }

  // =========================
  // Step 7: 회원가입 관련 조건
  // =========================
  if (
    normalizedUserInput.includes("회원가입") ||
    normalizedUserInput.includes("회원 등록") ||
    normalizedUserInput.includes("가입 방법")
  ) {
    const key = "회원 가입 방법";
    if (companyData.homePage && companyData.homePage[key]) {
      return {
        text: companyData.homePage[key].description,
        videoHtml: null,
        description: companyData.homePage[key].description,
        imageUrl: companyData.homePage[key].imageUrl ? companyData.homePage[key].imageUrl : null
      };
    }
  }

  // =========================
  // Step 8: 배송정보(deliveryInfo) 관련 조건
  // =========================
  let deliveryPageMatch = null;
  let deliveryPageDistance = Infinity;
  if (companyData.deliveryInfo) {
    for (let question in companyData.deliveryInfo) {
      const normalizedQuestion = normalizeSentence(question);
      const distance = levenshtein.get(normalizedUserInput, normalizedQuestion);
      if (distance < deliveryPageDistance) {
        deliveryPageDistance = distance;
        deliveryPageMatch = companyData.deliveryInfo[question];
      }
    }
  }
  const deliveryPageThreshold = 8;
  if (deliveryPageMatch && deliveryPageDistance <= deliveryPageThreshold) {
    return {
      text: deliveryPageMatch.description,
      videoHtml: null,
      description: deliveryPageMatch.description,
      imageUrl: deliveryPageMatch.imageUrl ? deliveryPageMatch.imageUrl : null
    };
  }

  // =========================
  // Step 9: homePage 관련 조건
  // =========================
  let homePageMatch = null;
  let homePageDistance = Infinity;
  if (companyData.homePage) {
    for (let question in companyData.homePage) {
      if (question.includes("회원 가입 방법")) continue;
      const normalizedQuestion = normalizeSentence(question);
      const distance = levenshtein.get(normalizedUserInput, normalizedQuestion);
      if (distance < homePageDistance) {
        homePageDistance = distance;
        homePageMatch = companyData.homePage[question];
      }
    }
  }
  const homePageThreshold = 6;
  if (homePageMatch && homePageDistance <= homePageThreshold) {
    return {
      text: homePageMatch.description,
      videoHtml: null,
      description: homePageMatch.description,
      imageUrl: homePageMatch.imageUrl ? homePageMatch.imageUrl : null
    };
  }

  // =========================
  // Step 10: covering / biz 영역 최종 비교
  // =========================
  let bestMatch = null;
  let bestDistance = Infinity;
  let bestCategory = null;

  if (companyData.covering) {
    for (let question in companyData.covering) {
      const normalizedQuestion = normalizeSentence(question);
      const distance = levenshtein.get(normalizedUserInput, normalizedQuestion);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = companyData.covering[question];
        bestCategory = "covering";
      }
    }
  }
  if (companyData.biz) {
    for (let question in companyData.biz) {
      const normalizedQuestion = normalizeSentence(question);
      const distance = levenshtein.get(normalizedUserInput, normalizedQuestion);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = companyData.biz[question];
        bestCategory = "biz";
      }
    }
  }
  const finalThreshold = 7;
  if (bestDistance > finalThreshold) {
    return {
      text: "질문을 이해하지 못했어요. 좀더 자세히 입력 해주시겠어요",
      videoHtml: null,
      description: null,
      imageUrl: null
    };
  }
  if (bestCategory === "covering") {
    const videoUrl = bestMatch.videoUrl ? bestMatch.videoUrl : null;
    return {
      text: bestMatch.answer,
      videoHtml: videoUrl
        ? `<iframe width="100%" height="315" src="${videoUrl}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`
        : null,
      description: null,
      imageUrl: null
    };
  } else if (bestCategory === "biz") {
    return {
      text: bestMatch.description + " " + getAdditionalBizComment(),
      videoHtml: null,
      description: bestMatch.description,
      imageUrl: null
    };
  }

  return {
    text: "알 수 없는 오류가 발생했습니다.",
    videoHtml: null,
    description: null,
    imageUrl: null
  };
}


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
