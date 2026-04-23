export function createEventHub() {
  const subscribers = {
    dashboard: new Set(),
    overlay: new Set(),
  };

  function isSupportedChannel(channel) {
    return Object.hasOwn(subscribers, channel);
  }

  function subscribe(channel, ws) {
    if (!isSupportedChannel(channel)) return false;
    subscribers[channel].add(ws);
    ws.on("close", () => {
      subscribers[channel].delete(ws);
    });
    return true;
  }

  function publish(channel, payload) {
    if (!isSupportedChannel(channel)) {
      return 0;
    }

    const data = JSON.stringify(payload);
    let delivered = 0;

    for (const ws of subscribers[channel]) {
      if (ws.readyState !== ws.OPEN) continue;
      ws.send(data);
      delivered += 1;
    }

    return delivered;
  }

  function getStats() {
    return {
      dashboardSubscribers: subscribers.dashboard.size,
      overlaySubscribers: subscribers.overlay.size,
    };
  }

  return {
    isSupportedChannel,
    subscribe,
    publish,
    getStats,
  };
}
