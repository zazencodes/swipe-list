#!/usr/bin/env node
// Downloads an X post's media and text through the fxtwitter API (no login, no browser).
//
//   node x-post.mjs <post url> <out dir>
//
// Writes <out dir>/x-<n>.jpg for photos (original size), <out dir>/x-<n>.mp4 for
// videos and GIFs (highest-bitrate MP4) with <out dir>/x-<n>-thumb.jpg as each one's
// poster frame, and prints JSON describing the post and every file to stdout.
// Exits non-zero with a reason when the post cannot be fetched.
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) {
  console.error("usage: node x-post.mjs <post url> <out dir>");
  process.exit(2);
}
const match = new URL(url).pathname.match(/\/status\/(\d+)(?:\/(?:video|photo)\/(\d+))?/);
if (!match) {
  console.error(`${url} is not an X post URL (expected .../status/<id>)`);
  process.exit(2);
}
const [, id, pick] = match;

async function fetchOk(target) {
  const res = await fetch(target, { headers: { "user-agent": "swipe-list-worker" } });
  if (!res.ok) throw new Error(`GET ${target} failed with ${res.status}`);
  return res;
}

const api = await (await fetchOk(`https://api.fxtwitter.com/status/${id}`)).json();
const tweet = api.tweet;
if (!tweet) throw new Error(`fxtwitter returned no post for ${id}: ${JSON.stringify(api).slice(0, 300)}`);

/** The worker refuses anything larger, so stop the download there. */
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

// Streams to disk with a size limit, replacing an earlier run's file but never writing through a link.
async function save(source, name) {
  const file = path.join(outDir, name);
  const res = await fetchOk(source);
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try {
    let written = 0;
    for await (const chunk of res.body) {
      written += chunk.byteLength;
      if (written > MAX_BYTES) throw new Error(`${name} is larger than 2 GB`);
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  return file;
}

const bestMp4 = (media) =>
  (media.formats ?? [])
    .filter((f) => f.container === "mp4")
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0]?.url ?? media.url;

const describe = (post) => ({
  url: post.url,
  text: post.raw_text?.text ?? post.text,
  author: { handle: post.author?.screen_name, name: post.author?.name },
  created_at: post.created_at,
  media: post.media?.all ?? [],
});

// /video/<n> and /photo/<n> name one piece of media, counting from 1.
const all = tweet.media?.all ?? [];
const chosen = pick ? [all[Number(pick) - 1]].filter(Boolean) : all;
const files = [];
for (const [index, media] of chosen.entries()) {
  const n = pick ? Number(pick) : index + 1;
  if (media.type === "photo") {
    const original = new URL(media.url);
    original.search = "?name=orig";
    files.push({ role: "image", file: await save(original.href, `x-${n}.jpg`), source_url: original.href });
  } else {
    const video = bestMp4(media);
    files.push({ role: "video", file: await save(video, `x-${n}.mp4`), source_url: video, duration: media.duration });
    if (media.thumbnail_url) {
      files.push({ role: "thumbnail", file: await save(media.thumbnail_url, `x-${n}-thumb.jpg`), source_url: media.thumbnail_url });
    }
  }
}

console.log(
  JSON.stringify(
    {
      post: describe(tweet),
      quote: tweet.quote ? describe(tweet.quote) : null,
      picked: pick ? Number(pick) : null,
      files,
    },
    null,
    2,
  ),
);
