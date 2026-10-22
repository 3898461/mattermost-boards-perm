package api

import (
	"testing"

	"github.com/mattermost/mattermost-plugin-boards/server/model"
	"github.com/stretchr/testify/assert"
)

func TestMaskSensitiveBlocks(t *testing.T) {
	board := &model.Board{
		ID: "board-1",
		CardProperties: []map[string]interface{}{
			{
				"id":        "prop-price",
				"name":      "单价",
				"visibleTo": []interface{}{"usr-admin-1"},
			},
			{
				"id":        "prop-amount",
				"name":      "实际金额",
				"visibleTo": []interface{}{"usr-admin-1"},
			},
			{
				"id":   "prop-title",
				"name": "任务标题",
			},
		},
	}

	cardBlock := &model.Block{
		ID:      "card-101",
		BoardID: "board-1",
		Type:    model.TypeCard,
		Fields: map[string]interface{}{
			"properties": map[string]interface{}{
				"prop-price":  "2400",
				"prop-amount": "20400",
				"prop-title":  "核心资产建模",
			},
		},
	}

	viewBlock := &model.Block{
		ID:      "view-stats",
		BoardID: "board-1",
		Type:    model.TypeView,
		Fields: map[string]interface{}{
			"visibleTo": []interface{}{"usr-admin-1"},
		},
	}

	blocks := []*model.Block{cardBlock, viewBlock}
	api := &API{}

	t.Run("普通成员调用：单价与实际金额字段必须被剔除，受限视图不予下发", func(t *testing.T) {
		masked := api.maskSensitiveBlocks(blocks, board, "usr-editor-9")
		assert.Equal(t, 1, len(masked))
		card := masked[0]
		props, ok := card.Fields["properties"].(map[string]interface{})
		assert.True(t, ok)
		_, hasPrice := props["prop-price"]
		_, hasAmount := props["prop-amount"]
		_, hasTitle := props["prop-title"]
		assert.False(t, hasPrice)
		assert.False(t, hasAmount)
		assert.True(t, hasTitle)
	})

	t.Run("管理员调用：全量属性与受限视图原样下发", func(t *testing.T) {
		assert.Equal(t, 2, len(blocks))
	})
}
