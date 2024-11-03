// ==UserScript==
// @name         Claude Chat Exporter
// @namespace    lugia19.com
// @match        https://claude.ai/*
// @version      1.0.5
// @author       lugia19
// @license      GPLv3
// @description  Allows exporting chat conversations from claude.ai.
// @grant        none
// ==/UserScript==

(function () {
	'use strict';

	const SELECTORS = {
		USER_MESSAGE: '[data-testid="user-message"]',
		AI_MESSAGE: '.font-claude-message',
	};

	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	function createExportCard() {
		const container = document.createElement('div');
		container.style.cssText = `
            position: fixed;
            top: 80px;
            left: calc(100% - 200px);
            background: #2D2D2D;
            border: 1px solid #3B3B3B;
            border-radius: 8px;
            z-index: 9999;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            padding: 10px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            cursor: move;
            user-select: none;
            width: 180px;
        `;

		const exportButton = document.createElement('button');
		exportButton.textContent = 'Export chat';
		exportButton.style.cssText = `
            background: #3b82f6;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            width: 100%;
        `;

		const formatDropdown = document.createElement('select');
		formatDropdown.innerHTML = `
            <option value="txt">Text (.txt)</option>
            <option value="jsonl">JSONL (.jsonl)</option>
        `;
		formatDropdown.style.cssText = `
            background: #3B3B3B;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            width: 100%;
            appearance: none;
            -webkit-appearance: none;
            -moz-appearance: none;
            background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='white'><path d='M7 10l5 5 5-5z'/></svg>");
            background-repeat: no-repeat;
            background-position: right 8px center;
            background-size: 16px;
        `;

		container.appendChild(exportButton);
		container.appendChild(formatDropdown);
		document.body.appendChild(container);

		exportButton.addEventListener('click', async () => {
			const conversationId = getConversationId();
			if (!conversationId) {
				alert('Not in a conversation.');
				return;
			}

			const messages = await getMessages();
			const format = formatDropdown.value;
			const filename = `Claude_export_${conversationId}.${format}`;
			const content = formatExport(messages, format);

			downloadFile(filename, content);
		});

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
		});

		document.addEventListener('mousemove', (e) => {
			if (!isDragging) return;
			e.preventDefault();
			currentX = e.clientX - initialX;
			currentY = e.clientY - initialY;
			container.style.left = `${currentX}px`;
			container.style.top = `${currentY}px`;
		});

		document.addEventListener('mouseup', () => {
			isDragging = false;
		});
	}

	async function getMessages() {
		const userMessages = document.querySelectorAll(SELECTORS.USER_MESSAGE);
		const aiMessages = document.querySelectorAll(SELECTORS.AI_MESSAGE);

		const messages = [];

		for (let i = 0; i < Math.max(userMessages.length, aiMessages.length); i++) {
			if (i < userMessages.length) {
				messages.push({ role: 'user', content: userMessages[i].textContent });
			}
			if (i < aiMessages.length) {
				messages.push({ role: 'assistant', content: aiMessages[i].textContent });
			}
		}

		return messages;
	}

	function formatExport(messages, format) {
		switch (format) {
			case 'txt':
				return messages.map(msg => {
					const role = msg.role === 'user' ? 'User' : 'Assistant';
					return `[${role}]\n${msg.content}\n`;
				}).join('\n');
			case 'jsonl':
				return messages.map(JSON.stringify).join('\n');
			default:
				throw new Error(`Unsupported format: ${format}`);
		}
	}

	function downloadFile(filename, content) {
		const blob = new Blob([content], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		link.click();
		URL.revokeObjectURL(url);
	}

	function initialize() {
		createExportCard();
	}

	initialize();
})();