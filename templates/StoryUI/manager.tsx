/**
 * Story UI Storybook Manager Addon
 *
 * This addon integrates with Storybook's sidebar to show generated stories.
 * In Edge mode, it fetches stories from the Edge Worker and adds them to the sidebar.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { addons, types } from '@storybook/manager-api';
import { useStorybookApi, useChannel } from '@storybook/manager-api';
import { IconButton } from '@storybook/components';
import { styled } from '@storybook/theming';

// Addon identifier
const ADDON_ID = 'story-ui';
const PANEL_ID = `${ADDON_ID}/generated-stories`;
const TOOL_ID = `${ADDON_ID}/tool`;

// Event channels for communication between panel and manager
export const EVENTS = {
  STORY_GENERATED: `${ADDON_ID}/story-generated`,
  REFRESH_STORIES: `${ADDON_ID}/refresh-stories`,
  SELECT_GENERATED_STORY: `${ADDON_ID}/select-generated-story`,
};

// Types
interface GeneratedStory {
  id: string;
  title: string;
  createdAt: number;
  framework?: string;
}

// Styled components
const SidebarContainer = styled.div`
  padding: 10px;
`;

const SectionTitle = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: ${({ theme }) => theme.color.mediumdark};
  text-transform: uppercase;
  letter-spacing: 0.35em;
  padding: 10px 0;
  border-bottom: 1px solid ${({ theme }) => theme.appBorderColor};
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const StoryList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
`;

const StoryItem = styled.li<{ isActive?: boolean }>`
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  color: ${({ theme, isActive }) => isActive ? theme.color.secondary : theme.color.defaultText};
  background: ${({ theme, isActive }) => isActive ? theme.background.hoverable : 'transparent'};

  &:hover {
    background: ${({ theme }) => theme.background.hoverable};
  }

  display: flex;
  align-items: center;
  gap: 8px;
`;

const StoryIcon = styled.span`
  font-size: 14px;
`;

const EmptyState = styled.div`
  padding: 20px;
  text-align: center;
  color: ${({ theme }) => theme.color.mediumdark};
  font-size: 12px;
`;

const RefreshButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: ${({ theme }) => theme.color.mediumdark};
  font-size: 14px;

  &:hover {
    color: ${({ theme }) => theme.color.secondary};
  }
`;

/**
 * Get the Edge URL from environment variable.
 * This must be configured via VITE_STORY_UI_EDGE_URL environment variable.
 * No hardcoded URLs - each deployment must configure their own backend.
 */
function getEdgeUrl(): string {
  // Check for Vite env variable - this is the ONLY source for the Edge URL
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_STORY_UI_EDGE_URL) {
    return import.meta.env.VITE_STORY_UI_EDGE_URL;
  }

  // No fallback - environment variable must be configured
  return '';
}

/**
 * Check if we're in Edge mode
 */
function isEdgeMode(): boolean {
  const edgeUrl = getEdgeUrl();
  if (edgeUrl) return true;

  // Check if we're on a production domain
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    return hostname !== 'localhost' && hostname !== '127.0.0.1';
  }

  return false;
}

/**
 * Generated Stories Sidebar Component
 */
const GeneratedStoriesSidebar: React.FC = () => {
  const api = useStorybookApi();
  const [stories, setStories] = useState<GeneratedStory[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeStoryId, setActiveStoryId] = useState<string | null>(null);

  // Listen for story generation events from the panel
  useChannel({
    [EVENTS.STORY_GENERATED]: (data: GeneratedStory) => {
      setStories(prev => [data, ...prev.filter(s => s.id !== data.id)]);
    },
    [EVENTS.REFRESH_STORIES]: () => {
      fetchStories();
    },
  });

  const fetchStories = useCallback(async () => {
    if (!isEdgeMode()) return;

    setLoading(true);
    try {
      const edgeUrl = getEdgeUrl();
      const response = await fetch(`${edgeUrl}/story-ui/stories`);
      if (response.ok) {
        const data = await response.json();
        setStories(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Failed to fetch generated stories:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStories();
  }, [fetchStories]);

  const handleStoryClick = useCallback((story: GeneratedStory) => {
    setActiveStoryId(story.id);

    // Navigate to the Generated Story Renderer with the story ID
    // The renderer is a special story that fetches and displays the generated content
    api.selectStory('storyui-generated--story-renderer', undefined, {
      ref: undefined,
    });

    // Emit event for the preview to pick up
    const channel = addons.getChannel();
    channel.emit(EVENTS.SELECT_GENERATED_STORY, story);
  }, [api]);

  if (!isEdgeMode()) {
    return (
      <SidebarContainer>
        <EmptyState>
          Generated stories appear here in Edge mode
        </EmptyState>
      </SidebarContainer>
    );
  }

  return (
    <SidebarContainer>
      <SectionTitle>
        Generated Stories
        <RefreshButton onClick={fetchStories} title="Refresh stories">
          {loading ? '...' : '\u21bb'}
        </RefreshButton>
      </SectionTitle>

      {stories.length === 0 ? (
        <EmptyState>
          {loading ? 'Loading...' : 'No generated stories yet'}
        </EmptyState>
      ) : (
        <StoryList>
          {stories.map((story) => (
            <StoryItem
              key={story.id}
              isActive={activeStoryId === story.id}
              onClick={() => handleStoryClick(story)}
            >
              <StoryIcon>&#128214;</StoryIcon>
              {story.title}
            </StoryItem>
          ))}
        </StoryList>
      )}
    </SidebarContainer>
  );
};

/**
 * Toolbar button to toggle generated stories panel
 */
const GeneratedStoriesToolbar: React.FC = () => {
  const api = useStorybookApi();

  if (!isEdgeMode()) return null;

  return (
    <IconButton
      key={TOOL_ID}
      title="Generated Stories"
      onClick={() => {
        api.togglePanel(true);
        api.setSelectedPanel(PANEL_ID);
      }}
    >
      <span style={{ fontSize: '14px' }}>&#10024;</span>
    </IconButton>
  );
};

// Register the addon
addons.register(ADDON_ID, (api) => {
  // Only register in Edge mode
  if (!isEdgeMode()) return;

  // Register the toolbar button
  addons.add(TOOL_ID, {
    type: types.TOOL,
    title: 'Generated Stories',
    match: ({ viewMode }) => viewMode === 'story' || viewMode === 'docs',
    render: () => <GeneratedStoriesToolbar />,
  });

  // Register the sidebar panel
  addons.add(PANEL_ID, {
    type: types.PANEL,
    title: 'Generated',
    match: ({ viewMode }) => viewMode === 'story' || viewMode === 'docs',
    render: ({ active }) => active ? <GeneratedStoriesSidebar /> : null,
  });
});

export default {};
