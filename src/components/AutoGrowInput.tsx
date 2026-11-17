/**
 * Multiline TextInput that is exactly as tall as its text, on iOS and web.
 * iOS grows natively (scrollEnabled=false). Browsers' textareas don't, so on web an invisible
 * copy of the text sets the height and the textarea is laid over it (it also shrinks).
 */
import { type Ref } from 'react';
import {
  Platform,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputInstance,
  type TextInputProps,
  type TextStyle,
  View,
} from 'react-native';

export function AutoGrowInput({
  ref,
  textStyle,
  value,
  placeholder,
  ...rest
}: Omit<TextInputProps, 'style' | 'multiline'> & { ref?: Ref<TextInputInstance>; textStyle: StyleProp<TextStyle>; value: string }) {
  if (Platform.OS !== 'web') {
    return (
      <TextInput
        ref={ref}
        value={value}
        placeholder={placeholder}
        multiline
        scrollEnabled={false}
        style={[textStyle, styles.native]}
        {...rest}
      />
    );
  }
  return (
    <View style={styles.wrap}>
      <Text style={[textStyle, styles.mirror]} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {value || placeholder || ' '}
        {'​'}
      </Text>
      <TextInput
        ref={ref}
        value={value}
        placeholder={placeholder}
        multiline
        numberOfLines={1}
        style={[textStyle, styles.overlay]}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  native: { padding: 0, margin: 0 },
  wrap: { flex: 1, position: 'relative' },
  mirror: { opacity: 0 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    margin: 0,
    resize: 'none',
    overflow: 'hidden',
    outlineStyle: 'none',
  } as object,
});
