"use strict";
module.exports = {
  hue: {
    number: 1,
    title: "색상",
    label: "파랑 계열",
    explanation:
      "이 예시는 파랑 계열입니다. 밝기나 선명함과 색의 계열을 따로 살펴보세요.",
  },
  brightness: {
    number: 2,
    title: "명도",
    label: "밝은 색 → 어두운 색",
    explanation:
      "같은 계열에서도 밝기는 달라집니다. 아래 순서와 내가 배열한 순서를 비교해보세요.",
    swatches: [
      { name: "가장 밝은 색", hex: "#e3e8f0" },
      { name: "두 번째", hex: "#9dadc4" },
      { name: "세 번째", hex: "#607795" },
      { name: "가장 어두운 색", hex: "#30415f" },
    ],
  },
  chroma: {
    number: 3,
    title: "채도",
    label: "A",
    explanation:
      "예시에서는 A가 B보다 선명하고, B는 더 차분하게 보이도록 구성했어요. 비슷한 색상과 밝기에서 선명함을 비교해보세요.",
  },
  tone: {
    number: 4,
    title: "색조",
    label: "A",
    explanation:
      "A는 밝고 부드러운 느낌, B는 더 어둡고 차분한 느낌의 예시예요. 밝기와 선명함을 함께 살펴보세요.",
  },
  temperature: {
    number: 5,
    title: "웜·쿨",
    label: "A",
    explanation:
      "예시 A는 노란 기가 더 도는 따뜻한 느낌, B는 푸른 기가 더 도는 차가운 느낌이에요. 화면에 따라 다르게 느낄 수 있으니 실물도 비교해보세요.",
  },
};
