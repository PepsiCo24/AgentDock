# V0.6 Browser multi-window synchronization

Each independent browser window connects to the local SSE /api/events endpoint. A ready event contains a random bootId. When the server restarts, a different bootId triggers a fresh /api/bootstrap request, including a new write token, agents, projects and session catalog.

Project and session creation/renaming broadcast scope:catalog change events. Ordinary activity sends change events that refresh the selected session. A disconnected browser periodically requests a fresh snapshot; it does not replay queued work. Browsers must stay connected to the same trusted localhost service.

Browser windows are NOT standalone vendor desktop-app windows. Native drag between system applications and shared vendor desktop-app history are not guaranteed.
