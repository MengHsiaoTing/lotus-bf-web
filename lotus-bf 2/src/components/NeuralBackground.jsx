// 裝飾用的網絡節點，不代表實際腦部連結。
const nodes = [
  [30, 130],
  [180, 80],
  [310, 190],
  [120, 300],
  [370, 360],
  [230, 510],
  [50, 640],
  [360, 730],
  [520, 120],
  [570, 490],

  [1410, 130],
  [1260, 80],
  [1130, 190],
  [1320, 300],
  [1070, 360],
  [1210, 510],
  [1390, 640],
  [1080, 730],
  [920, 120],
  [870, 490],
]

const edges = [
  [0, 1], [0, 3], [1, 2], [2, 3],
  [2, 4], [3, 4], [3, 5], [4, 5],
  [5, 6], [5, 7], [6, 7], [2, 8],
  [4, 9], [7, 9],

  [10, 11], [10, 13], [11, 12], [12, 13],
  [12, 14], [13, 14], [13, 15], [14, 15],
  [15, 16], [15, 17], [16, 17], [12, 18],
  [14, 19], [17, 19],

  [8, 18], [9, 19],
]

export function NeuralBackground() {
  return (
    <svg
      className="neural-background"
      viewBox="0 0 1440 800"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter
          id="neural-glow"
          x="-100%"
          y="-100%"
          width="300%"
          height="300%"
        >
          <feGaussianBlur stdDeviation="3" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 網絡連線 */}
      <g
        fill="none"
        stroke="#39cbd7"
        strokeWidth="1"
        strokeOpacity="0.22"
      >
        {edges.map(([a, b], index) => (
          <line
            key={index}
            x1={nodes[a][0]}
            y1={nodes[a][1]}
            x2={nodes[b][0]}
            y2={nodes[b][1]}
          />
        ))}
      </g>

      {/* 節點 */}
      <g fill="#65e6ee" filter="url(#neural-glow)">
        {nodes.map(([x, y], index) => (
          <circle
            key={index}
            cx={x}
            cy={y}
            r={index % 3 === 0 ? 3 : 2}
            opacity="0.6"
          />
        ))}
      </g>

      {/* 沿著連線移動的訊號 */}
      <g
        className="neural-signals"
        fill="#b9ffff"
        filter="url(#neural-glow)"
      >
        {edges.map(([a, b], index) => {
          const path =
            `M ${nodes[a][0]} ${nodes[a][1]} ` +
            `L ${nodes[b][0]} ${nodes[b][1]}`

          return (
            <circle key={index} r="2.6">
              <animateMotion
                path={path}
                dur={`${4 + index % 5}s`}
                begin={`${-index * 0.7}s`}
                repeatCount="indefinite"
              />
            </circle>
          )
        })}
      </g>
    </svg>
  )
}