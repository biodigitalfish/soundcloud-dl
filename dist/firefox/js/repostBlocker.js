function isStreamUrl(url) {
  return url && url.hostname === "api-v2.soundcloud.com" && url.pathname === "/stream";
}
function getFromLocalStorage(key) {
  const item = window.localStorage.getItem("SOUNDCLOUD-DL-" + key);
  return JSON.parse(item);
}
const twentyDaysInSeconds = 864e3;
function filterReposts(collection) {
  if (!collection) return [];
  const nowTimestamp = (/* @__PURE__ */ new Date()).getTime() / 1e3;
  const blockPlaylists = getFromLocalStorage("block-playlists");
  const followedArtistIds = getFromLocalStorage("followed-artists") ?? [];
  const filtered = [];
  for (const item of collection) {
    if (item.type === "track-promoted") continue;
    if (item.type === "track-repost") {
      if (!followedArtistIds.includes(item.track.user_id)) continue;
      const trackCreatedAtTimestamp = new Date(item.track.created_at).getTime() / 1e3;
      if (nowTimestamp - trackCreatedAtTimestamp > twentyDaysInSeconds) continue;
      item.type = "track";
      item.user = item.track.user;
      item.created_at = item.track.display_date;
    }
    if (blockPlaylists && item.type === "playlist") continue;
    if (item.type === "playlist-repost") {
      if (blockPlaylists) continue;
      if (!followedArtistIds.includes(item.playlist.user_id)) continue;
      const playlistCreatedAtTimestamp = new Date(item.playlist.created_at).getTime() / 1e3;
      if (nowTimestamp - playlistCreatedAtTimestamp > twentyDaysInSeconds) continue;
      item.type = "playlist";
      item.user = item.playlist.user;
      item.created_at = item.playlist.display_date;
    }
    filtered.push(item);
  }
  return filtered;
}
function removeReposts(json) {
  if (!json) return json;
  const data = JSON.parse(json);
  const filteredData = {
    ...data,
    collection: filterReposts(data.collection)
  };
  return JSON.stringify(filteredData);
}
const originalSendMethod = XMLHttpRequest.prototype.send;
function hijackedSendMethod(body) {
  try {
    if (this.__state) {
      const url = new URL(this.__state.url);
      const onload = this.onload;
      if (onload && isStreamUrl(url)) {
        this.onload = function(event) {
          Object.defineProperty(this, "responseText", {
            value: removeReposts(this.responseText)
          });
          onload.call(this, event);
        };
      }
    }
  } catch (error) {
    console.error("Error in hijackedSendMethod:", error);
  }
  return originalSendMethod.call(this, body);
}
XMLHttpRequest.prototype.send = hijackedSendMethod;
Object.defineProperty(XMLHttpRequest.prototype, "resetSend", {
  value: () => XMLHttpRequest.prototype.send = originalSendMethod
});
