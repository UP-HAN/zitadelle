# 치타델레 (Zitadelle)

하루에 30분, 무엇에 얼마나 집중했는지 기록하는 타이머입니다.
치타델레는 독일어로 요새 안의 작은 보루, 내성을 뜻합니다.

**https://zitadelle.ches.es.kr**

## 무엇을 하는가

- 주제를 적고 시간을 정해 집중을 기록합니다 (15·25·30·45·60분)
- 하루 목표(기본 30분)를 채운 날이 며칠 연속인지 세어 줍니다
- 3·7·14·30·50·100·150·200·250·300·365·500·730·1000일에 축하 화면이 한 번씩 뜹니다
- 오늘 목표를 아직 못 채웠는데 연속이 걸려 있으면 불꽃이 촛불로 바뀌며 알려 줍니다
- 최근 14일 그래프와 주제별 누적 시간을 보여 줍니다
- 기록을 CSV로 내보낼 수 있습니다

## 구성

| 파일 | 설명 |
| --- | --- |
| `index.html` | 앱 전체. 외부 라이브러리 없이 한 파일로 동작합니다 |
| `sync-server/server.js` | 기기 간 동기화 서버. Node 기본 모듈만 사용합니다 |
| `sync-server/zitadelle-sync.service` | systemd 유닛 파일 |
| `sync-server/devtest.js` | 로컬에서 확인해 보기 위한 시험 서버 |
| `deploy/nginx-zitadelle.conf` | 운영 중인 nginx 설정 사본 |

## 기록은 어디에 저장되는가

기본은 **각자 브라우저의 `localStorage`** 입니다. 로그인 없이 들어오면 그 기기에만 기록이 쌓이고
서버에는 아무것도 남지 않습니다. 방문자끼리도 서로의 기록을 볼 수 없습니다.

설정에서 **동기화 암호**를 넣으면 서버와도 맞춥니다. PC·태블릿·휴대폰에 같은 암호를 넣으면
어디서 보든 같은 기록이 됩니다. 인터넷이 끊겨도 기록은 기기에 먼저 저장되고, 연결되면 자동으로 맞춰집니다.

### 기록 합치는 규칙

기기 여러 대가 각각 기록을 올리므로 단순히 나중에 저장한 쪽이 이기면 기록이 사라집니다. 그래서
서버가 다음과 같이 합칩니다.

- 집중 기록은 `id` 기준 **합집합**. 한 기기에만 있던 기록도 살아남습니다
- 지운 기록은 `id`를 따로 남겨 두어, 다른 기기가 아직 그 기록을 들고 있어도 **되살아나지 않습니다**
- 설정은 **더 나중에 바꾼 쪽**을 따릅니다

## 체험 모드

상단 메뉴의 `체험` 을 누르면 약 100일치 예시 기록이 채워져, 연속 기록과 통계가 어떻게 보이는지
바로 확인할 수 있습니다. 예시 기록에는 `demo` 표시가 붙어 **서버로 전송되지 않고**, 다시 눌러
예시만 지울 수 있습니다. 직접 기록한 내용은 그대로 남습니다.

## 동기화 서버 설치

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin zitadelle
sudo mkdir -p /opt/zitadelle-sync /var/lib/zitadelle
sudo cp sync-server/server.js /opt/zitadelle-sync/
sudo chown -R zitadelle:zitadelle /var/lib/zitadelle

# 암호와 포트 (포트는 비어 있는지 sudo ss -tlnp 로 먼저 확인할 것)
printf 'ZITA_KEY=%s\nZITA_PORT=3210\nZITA_DIR=/var/lib/zitadelle\n' "$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)" \
  | sudo tee /etc/zitadelle-sync.env
sudo chmod 600 /etc/zitadelle-sync.env

sudo cp sync-server/zitadelle-sync.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now zitadelle-sync
```

서버는 `127.0.0.1` 에만 열리므로 외부에서 직접 접근할 수 없고, nginx의 `/api/` 를 통해서만 닿습니다.
기록은 `/var/lib/zitadelle/data.json` 에 저장되며 매일 백업본이 생기고 30일치를 보관합니다.

### 로컬에서 확인해 보기

```bash
ZITA_KEY=test-key-1234567890 ZITA_PORT=3199 ZITA_DIR=./_data node sync-server/server.js
node sync-server/devtest.js   # http://localhost:8080
```

## 주의할 점

`ZITA_KEY` 가 담긴 `/etc/zitadelle-sync.env` 와 SSH 키는 저장소에 올리지 않습니다 (`.gitignore` 참고).

`http://` 와 `https://` 는 브라우저가 서로 다른 사이트로 취급하므로 `localStorage` 도 분리됩니다.
주소 방식을 바꾸면 그때까지 기기에 쌓인 기록은 보이지 않습니다.
