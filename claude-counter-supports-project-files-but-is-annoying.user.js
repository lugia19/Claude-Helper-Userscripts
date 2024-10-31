// ==UserScript==
// @name         Claude Counter
// @namespace    Violentmonkey Scripts
// @match        https://claude.ai/*
// @version      1.0
// @author       lugia19
// @description  Counts tokens in chat messages
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
	'use strict';

	// Storage and Constants
	const STORAGE_KEY = 'chatTokenCounter_v1';
	const MODEL_SELECTOR = '[data-testid="model-selector-dropdown"]';
	const POLL_INTERVAL_MS = 1000;
	const DELAY_MS = 100;

	// Model-specific token limits - just guesstimates for now
	const MODEL_TOKENS = {
		'3.5 Sonnet (New)': 3500000,
		'3.5 Haiku': 2500000,
		'3 Opus': 1500000,
		default: 2500000
	};
	const WARNING_THRESHOLD = 0.9;

	// Selectors and identifiers
	const SELECTORS = {
		MAIN_INPUT: 'div[aria-label="Write your prompt to Claude"]',
		REGENERATE_BUTTON_PATH: 'M224,128a96,96,0,0,1-94.71,96H128A95.38,95.38,0,0,1,62.1,197.8a8,8,0,0,1,11-11.63A80,80,0,1,0,71.43,71.39a3.07,3.07,0,0,1-.26.25L44.59,96H72a8,8,0,0,1,0,16H24a8,8,0,0,1-8-8V56a8,8,0,0,1,16,0V85.8L60.25,60A96,96,0,0,1,224,128Z',
		SAVE_BUTTON: 'button[type="submit"]',
		EDIT_TEXTAREA: '.font-user-message textarea',
		USER_MESSAGE: '[data-testid="user-message"]',
		AI_MESSAGE: '.font-claude-message',
		SEND_BUTTON: 'button[aria-label="Send Message"]',
		SIDEBAR_BUTTON: '[data-testid="chat-controls"]',
		PROJECT_FILES_CONTAINER: '.border-border-400.rounded-lg.border', // The container for project files in sidebar
		PROJECT_FILES: 'button[data-testid="file-thumbnail"]',
		CONTENT_FILES: '.border-border-300.bg-bg-000.flex.flex-1',
		MODAL: '[role="dialog"]',
		MODAL_CONTENT: '.whitespace-pre-wrap.break-all.text-xs',
		MODAL_CLOSE: 'button:has(svg path[d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"])',
		BACK_BUTTON: 'button:has(svg path[d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z"])',
		SIDEBAR_CONTENT: '.bg-bg-100.border-0\\.5.border-border-300.flex-1',
		FILE_VIEW_CONTAINER: '.flex.h-full.flex-col.pb-1.pl-5.pt-3',
		FILE_CONTENT: '.whitespace-pre-wrap.break-all.text-xs',
	};

	let totalTokenCount = 0;
	let currentTokenCount = 0;
	let currentModel = getCurrentModel();

	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	function getCurrentModel() {
		const modelSelector = document.querySelector(MODEL_SELECTOR);
		if (!modelSelector) return 'default';

		const modelText = modelSelector.querySelector('.whitespace-nowrap')?.textContent?.trim() || 'default';
		console.log('Current model:', modelText);
		return modelText;
	}

	function getMaxTokens() {
		return MODEL_TOKENS[currentModel] || MODEL_TOKENS.default;
	}

	function getStorageKey() {
		return `${STORAGE_KEY}_${currentModel.replace(/\s+/g, '_')}`;
	}

	function getFileStorageKey(filename, isProjectFile = false) {
		const conversationId = getConversationId();
		return `${STORAGE_KEY}_${isProjectFile ? 'project' : 'content'}_${conversationId}_${filename}`;
	}

	async function waitForElement(selector, maxAttempts = 5) {
		let attempts = 0;
		while (attempts < maxAttempts) {
			const element = document.querySelector(selector);
			if (element) return element;

			await new Promise(resolve => setTimeout(resolve, 100));
			attempts++;
		}
		return null;
	}

	async function ensureSidebarOpen() {
		const isSidebarEmpty = (sidebar) => {
			if (!sidebar) return true;
			// Check for project files section or content files section
			const hasProjectFiles = sidebar.querySelector('.border-border-400.rounded-lg.border');
			const hasContentFiles = sidebar.querySelector('.mt-2.flex.flex-col.gap-2');
			return !hasProjectFiles && !hasContentFiles;
		};

		const isSidebarVisible = (sidebar) => {
			if (!sidebar) return false;
			const style = window.getComputedStyle(sidebar);
			return style.opacity !== '0' && !style.transform.includes('translateX(100%)');
		};

		const sidebar = document.querySelector(SELECTORS.SIDEBAR_CONTENT);
		console.log("Found sidebar:", sidebar)
		// If sidebar exists and has content, we don't need to open it again
		if (sidebar && !isSidebarEmpty(sidebar)) {
			console.log("Sidebar present and sidebar not empty")
			return true;
		}

		// If we get here, either there's no sidebar or it's empty
		// So we need to open/reload it
		const sidebarButton = document.querySelector(SELECTORS.SIDEBAR_BUTTON);
		if (!sidebarButton) {
			console.log('Could not find sidebar button');
			return false;
		}

		sidebarButton.click();

		// Wait for sidebar to become visible and populated
		let attempts = 0;
		while (attempts < 5) {
			const sidebar = document.querySelector(SELECTORS.SIDEBAR_CONTENT);
			if (sidebar && !isSidebarEmpty(sidebar) && isSidebarVisible(sidebar)) {
				await new Promise(resolve => setTimeout(resolve, 300));
				return true;
			}
			await new Promise(resolve => setTimeout(resolve, 100));
			attempts++;
		}
		console.log('Sidebar did not load properly');
		return false;
	}


	async function getProjectFileTokens(button) {
		try {
			const fileContainer = button.closest('div[data-testid]');
			if (!fileContainer) {
				console.log('Could not find project file container');
				return 0;
			}

			const filename = fileContainer.getAttribute('data-testid');
			console.log('Processing project file:', filename);

			const storageKey = getFileStorageKey(filename, true);
			const stored = GM_getValue(storageKey);
			if (stored !== undefined) {
				//console.log(`Using cached tokens for project file: ${filename}`);
				//return stored;
			}

			console.log(`Calculating tokens for project file: ${filename}`);
			button.click();

			const modal = await waitForElement(SELECTORS.MODAL);
			if (!modal) {
				console.log('Could not find modal');
				return 0;
			}

			const content = modal.querySelector(SELECTORS.MODAL_CONTENT);
			if (!content) {
				console.log('Could not find modal content');
				return 0;
			}
			console.log("Found modal content", content)

			const tokens = calculateTokens(content.textContent || '');
			console.log(`Project file ${filename} tokens:`, tokens);

			if (tokens > 0) {
				GM_setValue(storageKey, tokens);
			}

			const closeButton = modal.querySelector(SELECTORS.MODAL_CLOSE);
			console.log("Found close button:", closeButton)
			if (closeButton) {
				closeButton.click();
			} else {
				console.log("Could not find close button!")
			}

			return tokens;
		} catch (error) {
			console.error('Error processing project file:', error);
			return 0;
		}
	}

	async function getContentFileTokens(button) {
		try {
			const filename = button.querySelector('.break-words.text-sm')?.textContent;
			if (!filename) {
				console.log('Could not find content file name');
				return 0;
			}

			console.log('Processing content file:', filename);

			const storageKey = getFileStorageKey(filename, false);
			const stored = GM_getValue(storageKey);
			if (stored !== undefined) {
				/*console.log(`Using cached tokens for content file: ${filename}`);
				return stored;*/
			}

			console.log(`Calculating tokens for content file: ${filename}`);
			button.click();

			const fileView = await waitForElement(SELECTORS.FILE_VIEW_CONTAINER);
			if (!fileView) {
				console.log('Could not find file view');
				return 0;
			}

			const content = fileView.querySelector(SELECTORS.FILE_CONTENT);
			if (!content) {
				console.log('Could not find file content');
				return 0;
			}

			const tokens = calculateTokens(content.textContent || '');
			console.log(`Content file ${filename} tokens:`, tokens);

			if (tokens > 0) {
				GM_setValue(storageKey, tokens);
			}

			const backButton = fileView.querySelector(SELECTORS.BACK_BUTTON);
			if (backButton) {
				backButton.click();
			}

			return tokens;
		} catch (error) {
			console.error('Error processing content file:', error);
			return 0;
		}
	}

	function pollForModelChanges() {
		setInterval(() => {
			const newModel = getCurrentModel();
			if (newModel !== currentModel) {
				console.log(`Model changed from ${currentModel} to ${newModel}`);
				currentModel = newModel;
				currentTokenCount = 0;
				const { total } = initializeOrLoadStorage();
				totalTokenCount = total;
				updateProgressBar(totalTokenCount, 0);
			}
		}, POLL_INTERVAL_MS);
	}

	function createProgressBar() {
		const container = document.createElement('div');
		container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 200px;
            padding: 10px;
            background: #2D2D2D;
            border: 1px solid #3B3B3B;
            border-radius: 8px;
            z-index: 9999;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            cursor: move; /* Show move cursor */
			user-select: none; /* Prevent text selection while dragging */
        `;

		const currentCountDisplay = document.createElement('div');
		currentCountDisplay.id = 'current-token-count';
		currentCountDisplay.style.cssText = `
            color: white;
            font-size: 12px;
            margin-bottom: 8px;
        `;
		currentCountDisplay.textContent = 'Last message: 0 tokens';

		const progressContainer = document.createElement('div');
		progressContainer.style.cssText = `
            background: #3B3B3B;
            height: 6px;
            border-radius: 3px;
            overflow: hidden;
        `;

		const progress = document.createElement('div');
		progress.id = 'token-progress-bar';
		progress.style.cssText = `
            width: 0%;
            height: 100%;
            background: #3b82f6;
            transition: width 0.3s ease, background-color 0.3s ease;
        `;

		const tooltip = document.createElement('div');
		tooltip.id = 'token-progress-tooltip';
		tooltip.style.cssText = `
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            opacity: 0;
            transition: opacity 0.2s;
            pointer-events: none;
            margin-bottom: 4px;
            white-space: nowrap;
        `;

		progressContainer.appendChild(progress);
		container.appendChild(currentCountDisplay);
		container.appendChild(progressContainer);
		container.appendChild(tooltip);
		document.body.appendChild(container);

		// Dragging functionality
		let isDragging = false;
		let currentX;
		let currentY;
		let initialX;
		let initialY;

		container.addEventListener('mousedown', (e) => {
			isDragging = true;
			initialX = e.clientX - container.offsetLeft;
			initialY = e.clientY - container.offsetTop;
			container.style.cursor = 'grabbing';
		});

		document.addEventListener('mousemove', (e) => {
			if (!isDragging) return;
			e.preventDefault();
			currentX = e.clientX - initialX;
			currentY = e.clientY - initialY;
			const maxX = window.innerWidth - container.offsetWidth;
			const maxY = window.innerHeight - container.offsetHeight;
			currentX = Math.min(Math.max(0, currentX), maxX);
			currentY = Math.min(Math.max(0, currentY), maxY);
			container.style.left = `${currentX}px`;
			container.style.top = `${currentY}px`;
			container.style.right = 'auto';
			container.style.bottom = 'auto';
		});

		document.addEventListener('mouseup', () => {
			isDragging = false;
			container.style.cursor = 'move';
		});

		container.addEventListener('mouseenter', () => {
			tooltip.style.opacity = '1';
		});
		container.addEventListener('mouseleave', () => {
			tooltip.style.opacity = '0';
		});
	}

	function updateProgressBar(currentTotal, lastCount) {
		const progress = document.getElementById('token-progress-bar');
		const tooltip = document.getElementById('token-progress-tooltip');
		const currentDisplay = document.getElementById('current-token-count');
		if (!progress || !tooltip || !currentDisplay) return;

		const maxTokens = getMaxTokens();
		const percentage = (currentTotal / maxTokens) * 100;
		progress.style.width = `${Math.min(percentage, 100)}%`;

		if (currentTotal >= maxTokens * WARNING_THRESHOLD) {
			progress.style.background = '#ef4444';
		} else {
			progress.style.background = '#3b82f6';
		}

		tooltip.textContent = `${currentTotal.toLocaleString()} / ${maxTokens.toLocaleString()} tokens (${percentage.toFixed(1)}%)`;
		currentDisplay.textContent = `Last message: ${lastCount.toLocaleString()} tokens`;
	}

	function calculateTokens(text) {
		const charCount = text.length;
		return Math.ceil((charCount / 4) * 1.2);
	}

	function getResetTime(currentTime) {
		const hourStart = new Date(currentTime);
		hourStart.setMinutes(0, 0, 0);
		const resetTime = new Date(hourStart);
		resetTime.setHours(hourStart.getHours() + 5);
		return resetTime;
	}

	function initializeOrLoadStorage() {
		const stored = GM_getValue(getStorageKey());

		if (stored) {
			const currentTime = new Date();
			const resetTime = new Date(stored.resetTimestamp);

			if (currentTime >= resetTime) {
				return { total: 0, isInitialized: false };
			} else {
				return { total: stored.total, isInitialized: true };
			}
		}
		return { total: 0, isInitialized: false };
	}

	function saveToStorage(count) {
		const currentTime = new Date();
		const { isInitialized } = initializeOrLoadStorage();

		if (!isInitialized) {
			const resetTime = getResetTime(currentTime);
			GM_setValue(getStorageKey(), {
				total: count,
				resetTimestamp: resetTime.getTime()
			});
		} else {
			const existing = GM_getValue(getStorageKey());
			GM_setValue(getStorageKey(), {
				total: count,
				resetTimestamp: existing.resetTimestamp
			});
		}
	}

	async function countTokens() {
		const userMessages = document.querySelectorAll(SELECTORS.USER_MESSAGE);
		const aiMessages = document.querySelectorAll(SELECTORS.AI_MESSAGE);

		console.log('Found user messages:', userMessages);
		console.log('Found AI messages:', aiMessages);

		let currentCount = 0;

		userMessages.forEach((msg, index) => {
			const text = msg.textContent || '';
			const tokens = calculateTokens(text);
			console.log(`User message ${index}:`, msg);
			console.log(`Text: "${text}"`);
			console.log(`Tokens: ${tokens}`);
			currentCount += tokens;
		});

		aiMessages.forEach((msg, index) => {
			const text = msg.textContent || '';
			const tokens = calculateTokens(text);
			console.log(`AI message ${index}:`, msg);
			console.log(`Text: "${text}"`);
			console.log(`Tokens: ${tokens}`);
			currentCount += tokens;
		});

		// Only try to get content files if we can open the sidebar
		console.log("Trying to open sidebar...")
		// Handle files
		if (await ensureSidebarOpen()) {
			// Find project files specifically within the sidebar's project section
			const projectContainer = document.querySelector(SELECTORS.PROJECT_FILES_CONTAINER);
			console.log("Found project container in sidebar:", projectContainer)
			const projectFiles = projectContainer?.querySelectorAll(SELECTORS.PROJECT_FILES) || [];
			console.log('Found project files in sidebar:', projectFiles);

			for (const button of projectFiles) {
				const tokens = await getProjectFileTokens(button);
				currentCount += tokens;
			}

			// Handle content files
			const contentFiles = document.querySelectorAll(SELECTORS.CONTENT_FILES);
			console.log('Found content files:', contentFiles);

			for (const button of contentFiles) {
				const tokens = await getContentFileTokens(button);
				currentCount += tokens;
			}
		}

		const { total, isInitialized } = initializeOrLoadStorage();
		console.log(`Loaded total: ${total}`)
		totalTokenCount = isInitialized ? total + currentCount : currentCount;
		currentTokenCount = currentCount;

		saveToStorage(totalTokenCount);

		const stored = GM_getValue(getStorageKey());
		const resetTime = new Date(stored.resetTimestamp);

		console.log(`Current conversation tokens: ${currentCount}`);
		console.log(`Total accumulated tokens: ${totalTokenCount}`);
		console.log(`Next reset at: ${resetTime.toLocaleTimeString()}`);

		updateProgressBar(totalTokenCount, currentCount);
	}

	function setupTokenTracking() {
		console.log("Setting up tracking...")
		document.addEventListener('click', async (e) => {
			const regenerateButton = e.target.closest(`button:has(path[d="${SELECTORS.REGENERATE_BUTTON_PATH}"])`);
			const saveButton = e.target.closest(SELECTORS.SAVE_BUTTON);
			const sendButton = e.target.closest('button[aria-label="Send Message"]');
			if (regenerateButton || saveButton || sendButton) {
				console.log('Clicked:', e.target);
				console.log('Event details:', e);
				const delay = getConversationId() ? DELAY_MS : 5000;
				console.log(`Waiting ${delay}ms before counting tokens`);
				await new Promise(resolve => setTimeout(resolve, delay));
				await countTokens();
				return;
			}
		});

		document.addEventListener('keydown', async (e) => {
			const mainInput = e.target.closest(SELECTORS.MAIN_INPUT);
			const editArea = e.target.closest(SELECTORS.EDIT_TEXTAREA);
			if ((mainInput || editArea) && e.key === 'Enter' && !e.shiftKey) {
				console.log('Enter pressed in:', e.target);
				console.log('Event details:', e);
				const delay = getConversationId() ? DELAY_MS : 5000;
				console.log(`Waiting ${delay}ms before counting tokens`);
				await new Promise(resolve => setTimeout(resolve, delay));
				await countTokens();
				return;
			}
		});
	}

	function initialize() {
		console.log('Initializing Chat Token Counter...');
		const { total } = initializeOrLoadStorage();
		totalTokenCount = total;
		currentTokenCount = 0;
		setupTokenTracking();
		createProgressBar();
		updateProgressBar(totalTokenCount, currentTokenCount);
		pollForModelChanges();
		console.log('Initialization complete. Ready to track tokens.');
	}

	initialize();
})();
