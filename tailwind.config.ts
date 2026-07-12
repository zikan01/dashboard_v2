import type { Config } from "tailwindcss";

// 프로토타입(고마워할매_대시보드_프로토타입_v2.html)의 색상 토큰을 그대로 이식
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#F4F0E8",
        cream: "#FCFAF5",
        border: "#E7E2D6",
        ink: "#2B2A26",
        muted: "#8A8577",
        faint: "#B3AC9C",
        green: {
          100: "#E4EFE7",
          700: "#2E7D5B",
          800: "#276A4D",
          900: "#1F5C43",
        },
        amber: {
          100: "#F3E7CE",
          700: "#A97B34",
        },
        sand: {
          100: "#ECE8E0",
          600: "#8A8577",
        },
      },
      borderRadius: {
        card: "14px",
        btn: "9px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,.04)",
      },
      fontFamily: {
        sans: [
          "Pretendard",
          "Apple SD Gothic Neo",
          "Malgun Gothic",
          "system-ui",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
export default config;
