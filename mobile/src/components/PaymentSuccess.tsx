import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors, radii, spacing, type as t } from "@/theme/tokens";

const SIZE = 104;
const TICK = "M31 53 L46 68 L74 39"; // in a SIZE x SIZE box
const TICK_LEN = 62; // path length (21.2 + 40.3), rounded up so the stroke starts fully hidden

// UPI-style success: the green disc pops in, a ring ripples out, the tick draws
// itself, then the details rise in. Plain Animated + react-native-svg (the tick
// is redrawn from a listener) so it behaves the same on Android and on the web.
export function PaymentSuccess({ amount, detail }: { amount: string; detail: string }) {
  const pop = useRef(new Animated.Value(0)).current;
  const ripple = useRef(new Animated.Value(0)).current;
  const draw = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const [drawn, setDrawn] = useState(0);

  useEffect(() => {
    const id = draw.addListener(({ value }) => setDrawn(value));
    Animated.parallel([
      Animated.spring(pop, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }),
      Animated.timing(ripple, { toValue: 1, delay: 150, duration: 800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(draw, { toValue: 1, delay: 250, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(rise, { toValue: 1, delay: 450, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    return () => draw.removeListener(id);
  }, [pop, ripple, draw, rise]);

  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      <View style={styles.badge}>
        <Animated.View
          style={[
            styles.ripple,
            {
              opacity: ripple.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.35, 0] }),
              transform: [{ scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
            },
          ]}
        />
        <Animated.View style={[styles.disc, { transform: [{ scale: pop }] }]}>
          <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            <Path
              d={TICK}
              stroke={colors.surface}
              strokeWidth={8}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              strokeDasharray={[TICK_LEN, TICK_LEN]}
              strokeDashoffset={TICK_LEN * (1 - drawn)}
            />
          </Svg>
        </Animated.View>
      </View>
      <Animated.View
        style={[styles.text, { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}
      >
        <Text style={styles.title}>Payment successful</Text>
        <Text style={styles.amount}>{amount}</Text>
        <Text style={styles.detail}>{detail}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: spacing.xl },
  badge: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  ripple: { position: "absolute", width: SIZE, height: SIZE, borderRadius: radii.pill, backgroundColor: colors.success },
  disc: { width: SIZE, height: SIZE, borderRadius: radii.pill, backgroundColor: colors.success },
  text: { alignItems: "center", gap: spacing.xs },
  title: { ...t.h2, color: colors.success },
  amount: { ...t.heroNumber, color: colors.textPrimary },
  detail: { ...t.body, color: colors.textSecondary, textAlign: "center" },
});
