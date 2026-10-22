package plugindelivery

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFormatMessageLockedFormat(t *testing.T) {
	msg := formatMessage("zhangsan", "@lisi 这个图标麻烦看一下", "图标需求20260603", "https://mm.example.com/boards/team/b/card")

	assert.Equal(t,
		"@zhangsan 在看板中@了你：\n#### @lisi 这个图标麻烦看一下\n来自[图标需求20260603](https://mm.example.com/boards/team/b/card)",
		msg)
}

func TestFormatMessageSanitizes(t *testing.T) {
	t.Run("多行评论折叠为单行并截断，消息恒为三行", func(t *testing.T) {
		long := strings.Repeat("很长的评论内容 ", 100)
		msg := formatMessage("a", "第一行\n第二行 "+long, "卡", "https://x")
		lines := strings.Split(msg, "\n")
		require.Len(t, lines, 3)
		assert.True(t, strings.HasPrefix(lines[1], "#### "))
		assert.Contains(t, lines[1], "第一行 第二行")
	})

	t.Run("卡片标题中的方括号被转义，不能注入额外链接", func(t *testing.T) {
		msg := formatMessage("a", "hi", "标题](https://evil.example)", "https://real.example/card")
		// the title's ] is escaped, so it cannot terminate the link text;
		// the only real link destination is the card link.
		assert.Contains(t, msg, `\](https://evil.example)`)
		assert.Equal(t, 1, strings.Count(msg, "](https://real.example/card)"))
	})

	t.Run("卡片标题中的强调与代码标记被转义", func(t *testing.T) {
		msg := formatMessage("a", "hi", "A套装*2_测`试", "https://x")
		assert.Contains(t, msg, `A套装\*2\_测\`+"`")
	})

	t.Run("空标题使用占位名", func(t *testing.T) {
		msg := formatMessage("a", "hi", "  ", "https://x")
		assert.Contains(t, msg, "[未命名卡片](https://x)")
	})
}

func TestFormatMessageNeverContainsBoardOrProperties(t *testing.T) {
	// formatMessage does not even receive board title or property
	// values; this test documents the contract with representative
	// sensitive strings that must never appear in a mention DM.
	msg := formatMessage("zhangsan", "请 @wangwu 确认", "项目卡", "https://x/card")
	// Note: the fixed phrase "在看板中@了你" contains the generic
	// word 看板; what must never leak is the board's title (which
	// formatMessage never receives) and any property values.
	for _, forbidden := range []string{"单价", "实际金额", "人天", "内部结算看板"} {
		require.NotContains(t, msg, forbidden)
	}
}
