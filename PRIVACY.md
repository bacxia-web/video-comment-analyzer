# Privacy

Effective: July 28, 2026

YouTube Panorama is a GitHub-only, bring-your-own-key Chrome extension. It has no YouTube Panorama account, developer-operated backend, analytics, advertising, or telemetry.

## Data the extension handles

Depending on the feature you use, YouTube Panorama handles:

- the canonical URL and video ID of the active YouTube video;
- transcript text and timestamps;
- video metadata such as title, channel, description, and duration;
- text you select in the transcript and nearby transcript context;
- transcript context around a timestamped note;
- content you ask to translate;
- public YouTube comments, replies, author display names, like counts, and publication timestamps that you explicitly fetch;
- notes you save;
- Supadata, Google YouTube Data API, and DeepSeek configuration, including API keys; and
- cached transcript, digest, comment-analysis, and translation results.

## Where data goes

### Supadata

YouTube Panorama sends the canonical YouTube video URL to `https://api.supadata.ai` with your Supadata API key. Supadata returns the transcript and timestamps. A Supadata key is required for transcript retrieval.

### Google YouTube Data API

When you choose **Fetch comments**, YouTube Panorama sends the active video ID and your Google API key to `https://www.googleapis.com/youtube/v3`. Google returns public comment threads and replies. The extension requests additional reply pages when a thread response is incomplete and stops after 1,000 collected items per video.

Comment data is not sent to DeepSeek until you separately choose **Analyze with AI**.

### DeepSeek

The published version sends AI feature content to DeepSeek V4 Flash at `https://api.deepseek.com`:

- transcript plus relevant title, channel, description, or duration for an overview;
- selected text plus nearby transcript context for an explanation;
- small semantic transcript batches currently needed for progressive Chinese
  translation, or requested overview or explanation content;
- nearby transcript context and video metadata when polishing a saved note.
- up to 400 sampled public comments, comment IDs, like counts, and reply status when you explicitly request comment analysis.

The endpoint and `deepseek-v4-flash` model are fixed in the published Settings page. You provide one DeepSeek API key. To use another provider or model, you must adapt your own local source copy and its permissions. The Settings page provides a coding-agent prompt for that purpose and warns you never to include an API key in the prompt or chat.

Requests go directly from the extension to Google, Supadata, or DeepSeek. They are authenticated with the keys you supply. YouTube Panorama's developer does not proxy or receive these requests.

Those services process data under their own terms, privacy policies, retention practices, and account settings. Do not send confidential, personal, or regulated content unless their terms and your obligations permit it.

## Local storage and retention

YouTube Panorama uses Chrome's local extension storage, not a YouTube Panorama cloud service.

- Supadata, Google, and DeepSeek settings and API keys remain on the device in Chrome's extension storage.
- Saved notes remain until you delete them or remove/clear the extension's data. The extension keeps up to 100 notes.
- Recent transcript, digest, and per-segment translation cache entries are stored
  locally. The cache is limited to 20 videos, and entries older than 30 days are
  removed when the side panel opens.
- Recent comment statistics, top comments, and validated AI analyses are cached locally for up to 20 videos. Full fetched comment collections are kept only in the active side-panel session.

Chrome extension storage is not a password vault. Anyone with sufficient access to your browser profile or device may be able to recover locally stored keys or content. Use scoped keys where providers support them, set spending limits, and rotate or revoke a key if the device or browser profile is compromised.

To remove data:

- delete individual saved notes in YouTube Panorama;
- use the Options page to clear cached digests, delete all notes, or reset all extension data;
- remove the extension or clear its stored data from Chrome to delete all local settings, keys, notes, and cache entries; and
- revoke keys in the Google Cloud, Supadata, or DeepSeek dashboard to stop their future use.

Clearing local data does not delete information already processed or retained by Google, Supadata, or DeepSeek. Use each service's controls for service-side requests.

## Permissions

YouTube Panorama uses Chrome permissions for these purposes:

- `sidePanel`: display the YouTube Panorama interface beside YouTube.
- `storage`: store settings, keys, notes, and cached results locally.
- `tabs`: identify and interact with the active YouTube tab.
- `scripting`: coordinate the extension's YouTube page controls.
- YouTube host access: read the active video's URL and metadata and provide timestamp controls.
- Supadata host access: retrieve transcripts.
- DeepSeek host access: provide AI overviews, comment analysis, explanations, translation, and note polishing through DeepSeek V4 Flash.
- Google APIs host access: retrieve public YouTube comments and replies through YouTube Data API v3.

YouTube Panorama does not use these permissions to monitor general browsing activity.

## No sale or advertising use

YouTube Panorama does not sell personal information, build advertising profiles, or share data with data brokers. It does not include analytics SDKs.

## Changes

Privacy-relevant changes will be documented in this file and in the repository history. Review updates before installing a new version.

## Questions

This repository does not provide a public support or issue channel. Review this policy, the source code, and each provider's documentation before using the extension. For a vulnerability or accidental secret exposure, follow the private process in [SECURITY.md](SECURITY.md).
