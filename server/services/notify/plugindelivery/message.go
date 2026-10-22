// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package plugindelivery

import (
	"fmt"
	"strings"
)

// Mention DM format, locked by deployment policy (2026-10-21,
// revised the same day to the three-line layout):
//
//	@{提及者} 在看板中@了你：
//	#### {评论原文}
//	来自[{卡片名称}]({卡片链接})
//
// Line 2 is the raw comment text as authored (comments normally
// begin with the @mention itself, e.g. "@test2 快上传文件"); the
// "#### " prefix renders it as a level-4 heading in Mattermost.
// The message must never contain the board title, and must never
// contain any card property values (单价/金额/人天/状态变迁 diffs are
// only ever produced by the subscriptions backend, which stays
// disabled). Comment text and card title are user-authored content
// that the mentioned user is expected to read; both are sanitized
// before formatting (whitespace collapsed to keep line 2 a single
// heading line, length capped, markdown special characters escaped
// in the title so it cannot break the one link the message is
// allowed to carry).
const mentionMessageTemplate = "@%s 在看板中@了你：\n#### %s\n来自[%s](%s)"

const (
	maxCommentRunes   = 300
	maxCardTitleRunes = 100
	untitledCard      = "未命名卡片"
)

func formatMessage(author string, extract string, card string, link string) string {
	return fmt.Sprintf(mentionMessageTemplate,
		cleanInline(author),
		cleanComment(extract),
		cleanCardTitle(card),
		link,
	)
}

// cleanInline collapses all whitespace (including newlines) to single
// spaces and trims the result.
func cleanInline(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}

// cleanComment sanitizes the mention extract (the comment/description
// text around the @mention) for a single-line DM.
func cleanComment(s string) string {
	return truncateRunes(cleanInline(s), maxCommentRunes)
}

// cleanCardTitle sanitizes a card title used as markdown link text.
// Brackets are escaped so a crafted title cannot inject extra links,
// and the emphasis/code markers (*, _, `) are escaped so a title
// cannot italicize or otherwise garble the surrounding message.
// Escaped characters render as themselves in Mattermost, so the
// visible title is unchanged.
func cleanCardTitle(s string) string {
	t := cleanInline(s)
	if t == "" {
		return untitledCard
	}
	t = strings.NewReplacer(
		`\`, `\\`,
		"[", `\[`,
		"]", `\]`,
		"*", `\*`,
		"_", `\_`,
		"`", "\\`",
	).Replace(t)
	return truncateRunes(t, maxCardTitleRunes)
}
