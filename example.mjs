import { readFileSync } from "node:fs";

const debateSeeds = JSON.parse(
    readFileSync(new URL("./debate-message.seed.json", import.meta.url))
);
const debate = debateSeeds.find(
    (seed) => seed.communityTopic === "기본소득 도입에 찬성하는가"
);

console.log(debate);