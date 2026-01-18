<template>
  <div class="ml-select-wrapper" :class="[size]" ref="selectRef">
    <div
      class="ml-select-trigger"
      :class="{ open: isOpen, focused: isFocused }"
      @click="toggleDropdown"
      @keydown.enter.prevent="toggleDropdown"
      @keydown.space.prevent="toggleDropdown"
      @keydown.escape="closeDropdown"
      @keydown.down.prevent="navigateOptions(1)"
      @keydown.up.prevent="navigateOptions(-1)"
      tabindex="0"
      @focus="isFocused = true"
      @blur="isFocused = false"
    >
      <span class="select-value">{{ displayValue }}</span>
      <Icon name="chevron-down" class="select-arrow" :class="{ rotated: isOpen }" />
    </div>

    <Transition name="dropdown">
      <div v-if="isOpen" class="ml-select-dropdown" :class="{ dropup: dropup }" ref="dropdownRef">
        <div class="select-options">
          <div
            v-for="(option, index) in options"
            :key="option.value ?? index"
            class="select-option"
            :class="{
              selected: isSelected(option.value),
              highlighted: highlightedIndex === index
            }"
            @click="selectOption(option.value)"
            @mouseenter="highlightedIndex = index"
          >
            {{ option.label }}
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import Icon from './Icon.vue'

interface SelectOption {
  label: string
  value: any
}

const props = withDefaults(defineProps<{
  modelValue: any
  options: SelectOption[]
  placeholder?: string
  size?: 'default' | 'small'
}>(), {
  size: 'default'
})

const emit = defineEmits<{
  'update:modelValue': [value: any]
  'change': [value: any]
}>()

const selectRef = ref<HTMLElement | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)
const isOpen = ref(false)
const isFocused = ref(false)
const highlightedIndex = ref(-1)
const dropup = ref(false)

// 显示的值
const displayValue = computed(() => {
  const selected = props.options.find(opt => opt.value === props.modelValue)
  return selected?.label ?? props.placeholder ?? '请选择'
})

// 判断是否选中
const isSelected = (value: any) => {
  return value === props.modelValue
}

// 切换下拉框
const toggleDropdown = () => {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    // 打开时，高亮当前选中项
    const selectedIndex = props.options.findIndex(opt => opt.value === props.modelValue)
    highlightedIndex.value = selectedIndex >= 0 ? selectedIndex : 0

    // 检测是否需要向上弹出
    setTimeout(() => {
      checkDropDirection()
    }, 0)
  }
}

// 检测下拉方向
const checkDropDirection = () => {
  if (!selectRef.value) return

  const rect = selectRef.value.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom
  const spaceAbove = rect.top
  const dropdownHeight = 280 // max-height of dropdown

  // 如果下方空间不足且上方空间充足，则向上弹出
  dropup.value = spaceBelow < dropdownHeight && spaceAbove > spaceBelow
}

// 关闭下拉框
const closeDropdown = () => {
  isOpen.value = false
  highlightedIndex.value = -1
}

// 选择选项
const selectOption = (value: any) => {
  emit('update:modelValue', value)
  emit('change', value)
  closeDropdown()
}

// 键盘导航
const navigateOptions = (direction: number) => {
  if (!isOpen.value) {
    isOpen.value = true
    highlightedIndex.value = props.options.findIndex(opt => opt.value === props.modelValue)
    if (highlightedIndex.value < 0) highlightedIndex.value = 0
    return
  }

  const newIndex = highlightedIndex.value + direction
  if (newIndex >= 0 && newIndex < props.options.length) {
    highlightedIndex.value = newIndex
  }
}

// 点击外部关闭
const handleClickOutside = (event: MouseEvent) => {
  if (selectRef.value && !selectRef.value.contains(event.target as Node)) {
    closeDropdown()
  }
}

// 监听键盘回车选择高亮项
const handleKeydown = (event: KeyboardEvent) => {
  if (isOpen.value && event.key === 'Enter' && highlightedIndex.value >= 0) {
    selectOption(props.options[highlightedIndex.value].value)
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleKeydown)
})

// 监听下拉框关闭时重置高亮
watch(isOpen, (newVal) => {
  if (!newVal) {
    highlightedIndex.value = -1
  }
})
</script>

<style scoped>
.ml-select-wrapper {
  position: relative;
  display: block;
  width: 100%;
  min-width: 140px;

  &.small {
    min-width: 80px;
    width: auto;
    display: inline-block;

    .ml-select-trigger {
      padding: 6px 10px;
      font-size: 13px;
      gap: 6px;
    }

    .select-option {
      padding: 6px 10px;
      font-size: 13px;
    }
  }
}

.ml-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--ml-border);
  border-radius: var(--ml-radius);
  background: var(--ml-bg-container);
  color: var(--ml-text);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: var(--ml-transition);
  user-select: none;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);

  &:hover {
    border-color: var(--ml-primary-border);
    background-color: var(--ml-bg-hover);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
  }

  &.focused,
  &.open {
    outline: none;
    border-color: var(--ml-primary);
    background-color: #fff;
    box-shadow: 0 0 0 3px var(--ml-primary-light), 0 2px 8px rgba(22, 119, 255, 0.15);
  }
}

.select-value {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-arrow {
  flex-shrink: 0;
  transition: transform 0.2s ease;
  color: var(--ml-text-tertiary);

  &.rotated {
    transform: rotate(180deg);
  }
}

.ml-select-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 1000;
  background: var(--ml-bg-container);
  border: 1px solid var(--ml-border);
  border-radius: var(--ml-radius);
  box-shadow: var(--ml-shadow);
  overflow: hidden;

  &.dropup {
    top: auto;
    bottom: calc(100% + 4px);
  }
}

.select-options {
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;

  /* 自定义滚动条 */
  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: var(--ml-bg-base);
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--ml-border-secondary);
    border-radius: 3px;

    &:hover {
      background: var(--ml-text-tertiary);
    }
  }
}

.select-option {
  padding: 8px 12px;
  font-size: 14px;
  color: var(--ml-text);
  cursor: pointer;
  border-radius: var(--ml-radius-sm);
  transition: var(--ml-transition-fast);
  user-select: none;

  &:hover,
  &.highlighted {
    background: var(--ml-primary-light);
    color: var(--ml-primary);
  }

  &.selected {
    background: var(--ml-primary);
    color: #fff;
    font-weight: 600;
  }
}

/* 下拉动画 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.ml-select-dropdown:not(.dropup) {
  transform-origin: top;

  &.dropdown-enter-from {
    opacity: 0;
    transform: scaleY(0.8) translateY(-8px);
  }

  &.dropdown-leave-to {
    opacity: 0;
    transform: scaleY(0.8) translateY(-8px);
  }
}

.ml-select-dropdown.dropup {
  transform-origin: bottom;

  &.dropdown-enter-from {
    opacity: 0;
    transform: scaleY(0.8) translateY(8px);
  }

  &.dropdown-leave-to {
    opacity: 0;
    transform: scaleY(0.8) translateY(8px);
  }
}
</style>
