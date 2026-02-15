import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { DraggableArea } from 'react-advanced-cropper';
import './RotateComponent.css';

function range(from, to, step = 1) {
	let index = -1;
	let length = Math.max(Math.ceil((to - from) / (step || 1)), 0);

	const result = new Array(length);

	while (length--) {
		result[++index] = from;
		from += step;
	}
	return result;
}

export const RotateComponent = forwardRef(
	(
		{
			from = -45,
			to = 45,
			value = 0,
			step = 2.5,
			thickness = 2,
			onBlur,
			onChange,
			className = '',
			valueBarClassName = '',
			barsClassName = '',
			barClassName = '',
			highlightedBarClassName = '',
			zeroBarClassName = '',
			density = 10,
		},
		ref,
	) => {
		const barsRef = useRef(null);

		const [dragging, setDragging] = useState(false);

		const [items, setItems] = useState([]);

		const recalculate = () => {
			if (barsRef.current) {
				const width = barsRef.current.clientWidth;

				const count = width / density;

				const neededLeftBarsCount = Math.max(0, Math.floor(count / 2) - Math.round((value - from) / step));

				const neededRightBarsCount = Math.max(0, Math.floor(count / 2) - Math.round((to - value) / step));

				const values = [
					...range(from - neededLeftBarsCount * step, from, step),
					...range(from, to + step, step),
					...range(to + step, to + step + neededRightBarsCount * step, step),
				];

				const radius = Math.abs(Math.ceil(count / 2) * step);

				setItems(
					values.map((barValue) => {
						const sign = Math.sign(barValue - value);

						// Opacity
						let translate;
						if (Math.abs(barValue - value) / step <= Math.ceil(count / 2)) {
							const multiplier =
								Math.sqrt(Math.pow(radius, 2) - Math.pow(value + sign * radius - barValue, 2)) / radius;
							translate = width / 2 + sign * (width / 2) * Math.pow(multiplier, 2.5);
						} else {
							translate = width / 2 + (sign * width) / 2;
						}

						// Translate
						let opacity = 0;
						if (count > 0 && Math.abs(barValue - value) / step <= Math.ceil(count / 2)) {
							opacity = Math.pow(
								Math.sqrt(Math.pow(radius, 2) - Math.pow(value - barValue, 2)) / radius,
								4,
							);
						}
                        
                        // Fix for NaN opacity if radius is 0 or other edge cases
                        if (isNaN(opacity)) opacity = 0;

						return {
							value: barValue,
							highlighted:
								(value < 0 && barValue >= value && barValue <= 0) ||
								(value > 0 && barValue <= value && barValue >= 0),
							zero: barValue === 0,
							opacity,
							translate: translate - thickness / 2,
						};
					}),
				);
			}
		};

		useEffect(() => {
			recalculate();
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [density, thickness, from, to, value, step]);
        
        // Also recalculate on resize? 
        useEffect(() => {
            const handleResize = () => recalculate();
            window.addEventListener('resize', handleResize);
            return () => window.removeEventListener('resize', handleResize);
        });

		useImperativeHandle(ref, () => {
			return {
				refresh: recalculate,
			};
		});

		const onMove = (directions) => {
			if (barsRef.current) {
                // directions.left is the delta movement in pixels
				const width = barsRef.current.clientWidth;
				const count = width / density;
                
                // Sensitivity adjustment: 
                // dragging full width should rotate by 'count * step' degrees?
				const shift = -(directions.left / barsRef.current.clientWidth) * count * step;
                
				if (onChange) {
					if (value + shift > to) {
						onChange(to - value); // Delta to reach max
					} else if (value + shift < from) {
						onChange(from - value); // Delta to reach min
					} else {
						onChange(shift); // Delta
					}
				}
			}
		};

		const onMoveEnd = () => {
			document.body.classList.remove('dragging');
			setDragging(false);
			onBlur && onBlur();
		};

		const onMoveStart = () => {
			document.body.classList.add('dragging');
			setDragging(true);
		};

		return (
			<div className={`telegram-rotate-component ${className}`}>
				<DraggableArea onMoveStart={onMoveStart} onMove={onMove} onMoveEnd={onMoveEnd} useAnchor={false}>
					<div
						className={`telegram-rotate-component__bars ${dragging ? 'telegram-rotate-component__bars--dragging' : ''} ${barsClassName}`}
						ref={barsRef}
					>
						{items.map((bar) => (
							<div
								className={`telegram-rotate-component__bar ${bar.zero ? 'telegram-rotate-component__bar--zero' : ''} ${bar.highlighted ? 'telegram-rotate-component__bar--highlighted' : ''} ${barClassName} ${bar.highlighted ? highlightedBarClassName : ''} ${bar.zero ? zeroBarClassName : ''}`}
								key={bar.value}
								style={{
									width: bar.opacity ? thickness : 0,
									opacity: bar.opacity,
									transform: `translate(${bar.translate}px, -50%)`,
								}}
							/>
						))}
						<div className={`telegram-rotate-component__value ${valueBarClassName}`}>
							<div className="telegram-rotate-component__value-number">{value.toFixed(1)}°</div>
						</div>
					</div>
				</DraggableArea>
			</div>
		);
	},
);

RotateComponent.displayName = 'RotateComponent';
