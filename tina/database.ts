import { createDatabase, TinaLevelClient } from "@tinacms/datalayer";
import { RedisLevel } from "@kldavis4/upstash-redis-level";
import { Octokit } from "@octokit/rest";
import { Base64 } from "js-base64";
import path from "path";
import fs from "fs";
import {Redis} from '@upstash/redis'

// Manage this flag in your CI/CD pipeline and make sure it is set to false in production
const isLocal = process.env.LOCAL_MODE === "true";

if (isLocal) console.log("Running TinaCMS in local mode.");
else console.log("Running TinaCMS in production mode.");

const owner = process.env.GITHUB_OWNER as string;
const repo = process.env.GITHUB_REPO as string;
const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN as string;
const branch = process.env.GITHUB_BRANCH as string;

const octokit = new Octokit({
  auth: token,
});

const localLevelStore = new TinaLevelClient();
const redisLevelStore = new RedisLevel<string,Record<string,any>>({
  redis: new Redis({
    url: process.env.KV_REST_API_URL as string || 'http://localhost:8079',
    token: process.env.KV_REST_API_TOKEN as string || 'example_token',
  }),
  debug: process.env.DEBUG === 'true' || false,
})
if (isLocal) localLevelStore.openConnection();

const githubOnPut = async (key, value) => {
  let sha;
  try {
    const {
      // @ts-ignore
      data: { sha: existingSha },
    } = await octokit.repos.getContent({
      owner,
      repo,
      path: key,
      ref: branch,
    });
    sha = existingSha;
  } catch (e) {}

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: key,
    message: "commit from self-hosted tina",
    content: Base64.encode(value),
    branch,
    sha,
  });
};
const localOnPut = async (key, value) => {
  const currentPath = path.join(process.cwd(), key);
  fs.writeFileSync(currentPath, value);
};

const githubOnDelete = async (key) => {
  let sha;
  try {
    const {
      // @ts-ignore
      data: { sha: existingSha },
    } = await octokit.repos.getContent({
      owner,
      repo,
      path: key,
      ref: branch,
    });
    sha = existingSha;
  } catch (e) {}

  if (sha) {
    await octokit.repos.deleteFile({
      owner,
      repo,
      path: key,
      message: "commit from self-hosted tina",
      branch,
      sha,
    });
  } else {
    throw new Error(`Could not find file ${key} in repo ${owner}/${repo}`);
  }
};
const localOnDelete = async (key) => {
  const currentPath = path.join(process.cwd(), key);
  fs.rmSync(currentPath);
};

export default createDatabase({
  level: isLocal ? localLevelStore : redisLevelStore,
  onPut: isLocal ? localOnPut : githubOnPut,
  onDelete: isLocal ? localOnDelete : githubOnDelete,
});
