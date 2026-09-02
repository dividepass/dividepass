-- Enable Realtime on platform_events for live admin notifications
ALTER PUBLICATION supabase_realtime ADD TABLE platform_events;
