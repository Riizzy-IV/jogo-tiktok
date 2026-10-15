-- Avatares da Live — Live Arcade (Script em ServerScriptService)
-- Quem comenta o nick do Roblox na live aparece dançando no palco com a skin de verdade.
-- Os eventos vêm do launcher (http://localhost:21213/roblox/poll): abra o Live Arcade, conecte a live e aperte Play (F5) no Studio.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local Debris = game:GetService("Debris")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

-- ========== Configuração ==========
local CFG = {
	url = "http://localhost:21213/roblox/poll",
	maxDancers = 20,        -- avatares no palco ao mesmo tempo (sai quem está há mais tempo sem interagir)
	idleSeconds = 600,      -- avatar sai do palco depois desse tempo sem comentar nem mandar presente
	commentCooldown = 3,    -- segundos entre comentários do mesmo usuário
	effectSeconds = 12,     -- duração da dança especial, aura e gigante
	rainCount = 24,         -- avatares na chuva (multiplicado pela quantidade do combo, até 3x)
	giantScale = 2.5,
}

-- Presentes com ação fixa (nome em minúsculas, como chega do TikTok). Os outros seguem as moedas.
local GIFT_ACTIONS = {
	["rosa"] = "danca", ["rose"] = "danca",
	["galáxia"] = "chuva", ["galaxy"] = "chuva",
}
local function actionByCoins(coins)
	if coins >= 1000 then return "chuva" end
	if coins >= 100 then return "gigante" end
	if coins >= 5 then return "aura" end
	return "danca"
end
local ACTION_LABEL = {
	danca = "dança especial", aura = "aura brilhante", gigante = "avatar gigante", chuva = "chuva de avatares",
}
local GIFT_ICONS = {
	["rosa"] = "🌹", ["rose"] = "🌹", ["rosa branca"] = "🤍", ["white rose"] = "🤍", ["gg"] = "🎮",
	["coração"] = "💖", ["finger heart"] = "💖", ["perfume"] = "🧴", ["rosquinha"] = "🍩", ["doughnut"] = "🍩",
	["mãos de coração"] = "🫶", ["hand hearts"] = "🫶", ["galáxia"] = "🌌", ["galaxy"] = "🌌", ["leão"] = "🦁", ["lion"] = "🦁",
}

-- Danças padrão do Roblox (R15), liberadas para qualquer jogo
local DANCES = {
	"rbxassetid://507771019", "rbxassetid://507771955", "rbxassetid://507772104",
	"rbxassetid://507776043", "rbxassetid://507776720", "rbxassetid://507776879",
	"rbxassetid://507777268", "rbxassetid://507777451", "rbxassetid://507777623",
}
local CHEER = "rbxassetid://507770677"

-- Palavras comuns no chat que também são nicks válidos: não viram avatar
local IGNORE = {}
for _, w in ipairs({ "boa", "noite", "tarde", "bom", "dia", "oii", "oie", "eae", "salve", "bora", "top", "sim", "nao",
	"vai", "que", "quero", "eu", "aqui", "amo", "lindo", "linda", "mano", "slk", "pfv", "dnv", "tmj", "vlw", "obg", "hello", "hii" }) do
	IGNORE[w] = true
end

-- ========== Cena ==========
local function stageBox()
	local p = workspace:FindFirstChild("Palco")
	if p and p:IsA("BasePart") then return p.CFrame, p.Size end
	if p and p:IsA("Model") then return p:GetBoundingBox() end
	return nil
end

-- Mapa vazio (script colado num Baseplate): monta um palco simples para funcionar de cara
if not stageBox() then
	local palco = Instance.new("Part")
	palco.Name = "Palco"
	palco.Anchored = true
	palco.Size = Vector3.new(64, 2, 36)
	palco.CFrame = CFrame.new(0, 1, 0)
	palco.Color = Color3.fromRGB(28, 28, 40)
	palco.Material = Enum.Material.SmoothPlastic
	palco.Parent = workspace
	local borda = Instance.new("Part")
	borda.Name = "BordaNeon"
	borda.Anchored = true
	borda.CanCollide = false
	borda.Size = Vector3.new(64, 0.4, 0.6)
	borda.CFrame = CFrame.new(0, 2.1, 18)
	borda.Color = Color3.fromRGB(37, 244, 238)
	borda.Material = Enum.Material.Neon
	borda.Parent = workspace
end

local stageCF, stageSize = stageBox()
if not workspace:FindFirstChild("CameraLive") then
	local cam = Instance.new("Part")
	cam.Name = "CameraLive"
	cam.Anchored = true
	cam.CanCollide = false
	cam.CanQuery = false
	cam.Transparency = 1
	cam.Size = Vector3.new(1, 1, 1)
	local top = stageSize.Y / 2
	cam.CFrame = CFrame.lookAt((stageCF * CFrame.new(0, top + 9, stageSize.Z / 2 + 20)).Position, (stageCF * CFrame.new(0, top + 3, 0)).Position)
	cam.Parent = workspace
end

local folder = Instance.new("Folder")
folder.Name = "AvataresDaLive"
folder.Parent = workspace

-- Sem personagem do streamer andando na frente da câmera
Players.CharacterAutoLoads = false

-- Avisos na tela de quem está no Play (o LocalScript AvataresTela desenha)
local remote = ReplicatedStorage:FindFirstChild("AvataresFeed") or Instance.new("RemoteEvent")
remote.Name = "AvataresFeed"
remote.Parent = ReplicatedStorage

local linkStatus = { ok = false, text = "Procurando o Live Arcade..." }
local function setLink(ok, text)
	if linkStatus.ok == ok and linkStatus.text == text then return end
	linkStatus = { ok = ok, text = text }
	remote:FireAllClients("status", linkStatus)
	print("[Avatares da Live] " .. text)
end
Players.PlayerAdded:Connect(function(p) remote:FireClient(p, "status", linkStatus) end)

local function feed(title, sub, userId, icon, color)
	remote:FireAllClients("feed", { title = title, sub = sub, userId = userId, icon = icon, color = color })
end

-- ========== Posição no palco ==========
-- O palco pode ter degraus (Model "Palco" com várias peças): a altura de cada ponto vem de um raio para baixo
local rayParams = RaycastParams.new()
rayParams.FilterType = Enum.RaycastFilterType.Include
rayParams.FilterDescendantsInstances = { workspace:FindFirstChild("Palco") }

local function groundAt(x, z)
	local origin = (stageCF * CFrame.new(x, stageSize.Y / 2 + 30, z)).Position
	local hit = workspace:Raycast(origin, Vector3.new(0, -(stageSize.Y + 60), 0), rayParams)
	if hit and hit.Normal.Y > 0.7 then return hit.Position end
	return nil
end

local function lookTarget(pos)
	local cam = workspace:FindFirstChild("CameraLive")
	local target = cam and cam.Position or (stageCF * CFrame.new(0, 0, stageSize.Z)).Position
	return Vector3.new(target.X, pos.Y, target.Z)
end

-- Põe o modelo de pé no ponto do palco (pos.Y = chão), virado para a câmera; vale também depois de mudar a escala
local function standAt(model, pos)
	model:PivotTo(CFrame.lookAt(pos, lookTarget(pos)))
	local cf, size = model:GetBoundingBox()
	local bottom = cf.Position.Y - size.Y / 2
	model:PivotTo(model:GetPivot() + Vector3.new(0, pos.Y - bottom, 0))
end

-- ========== Avatares ==========
local dancers = {}      -- id do TikTok → { model, animator, track, spot, label, userId, lastSeen, token }
local nameCache = {}    -- nick em minúsculas → userId
local missCache = {}    -- nick em minúsculas → os.clock() da última vez que não existia
local descCache = {}    -- userId → HumanoidDescription

local function countDancers()
	local n = 0
	for _ in pairs(dancers) do n += 1 end
	return n
end

local function freeSpot()
	local margin = 2.5
	local best, bestDist = nil, -1
	for _ = 1, 40 do
		local x = (math.random() - 0.5) * (stageSize.X - margin * 2)
		local z = (math.random() - 0.5) * (stageSize.Z - margin * 2)
		local pos = groundAt(x, z)
		if pos then
			local nearest = math.huge
			for _, d in pairs(dancers) do nearest = math.min(nearest, (d.spot - pos).Magnitude) end
			if nearest >= 4.5 then return pos end
			if nearest > bestDist then best, bestDist = pos, nearest end
		end
	end
	return best or (stageCF * CFrame.new(0, stageSize.Y / 2, 0)).Position
end

-- ========== Cenário: refletores, telão e flashes ==========
-- Tudo opcional: só age sobre peças da pasta Workspace > Cenario com esses nomes
local cenario = workspace:FindFirstChild("Cenario")
local stageCenter = (stageCF * CFrame.new(0, stageSize.Y / 2, 0)).Position

-- Refletor*: ganha luz e feixe e fica varrendo o palco trocando de cor
local lights = {}
for _, p in ipairs(cenario and cenario:GetDescendants() or {}) do
	if p:IsA("BasePart") and p.Name:match("^Refletor") then
		local spot = Instance.new("SpotLight")
		spot.Face, spot.Angle, spot.Range, spot.Brightness = Enum.NormalId.Front, 35, 50, 2.5
		spot.Parent = p
		local a0 = Instance.new("Attachment")
		a0.Position = Vector3.new(0, 0, -p.Size.Z / 2)
		a0.Parent = p
		local target = Instance.new("Part")
		target.Anchored, target.CanCollide, target.CanQuery, target.Transparency, target.Size = true, false, false, 1, Vector3.one
		target.Parent = folder
		local a1 = Instance.new("Attachment")
		a1.Parent = target
		local beam = Instance.new("Beam")
		beam.Attachment0, beam.Attachment1 = a0, a1
		beam.Width0, beam.Width1 = 0.8, 8
		beam.LightEmission, beam.LightInfluence = 1, 0
		beam.FaceCamera = true
		beam.Transparency = NumberSequence.new(0.72, 0.95)
		beam.Parent = p
		table.insert(lights, { part = p, spot = spot, beam = beam, target = target, base = p.Position, phase = #lights * 1.9 })
	end
end
if #lights > 0 then
	RunService.Heartbeat:Connect(function()
		local t = os.clock()
		for i, L in ipairs(lights) do
			local aim = stageCenter + Vector3.new(math.sin(t * 0.7 + L.phase) * stageSize.X * 0.4, 0, math.cos(t * 0.45 + L.phase) * stageSize.Z * 0.4)
			L.part.CFrame = CFrame.lookAt(L.base, aim)
			L.target.Position = aim
			local c = Color3.fromHSV((t * 0.05 + i * 0.25) % 1, 0.75, 1)
			L.spot.Color = c
			L.beam.Color = ColorSequence.new(c)
		end
	end)
end

-- Neon*: pisca na cor do presente grande
local neons = {}
for _, p in ipairs(cenario and cenario:GetDescendants() or {}) do
	if p:IsA("BasePart") and p.Name:match("^Neon") then table.insert(neons, { part = p, color = p.Color }) end
end
local function flash(color)
	for _, n in ipairs(neons) do
		n.part.Color = color
		TweenService:Create(n.part, TweenInfo.new(1.5), { Color = n.color }):Play()
	end
end

-- Telao: placar com quantos estão dançando e o maior presente da live
local telaoText = {}
local topGift = {}       -- id do TikTok → { name, coins }
local topGifter = nil
local telao = cenario and cenario:FindFirstChild("Telao")
if telao then
	local cam = workspace:FindFirstChild("CameraLive")
	local toCam = cam and (cam.Position - telao.Position) or Vector3.new(0, 0, 1)
	local sg = Instance.new("SurfaceGui")
	sg.Face = telao.CFrame.LookVector:Dot(toCam) > 0 and Enum.NormalId.Front or Enum.NormalId.Back
	sg.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	sg.PixelsPerStud = 40
	sg.LightInfluence = 0
	sg.Parent = telao
	local bg = Instance.new("Frame")
	bg.Size = UDim2.fromScale(1, 1)
	bg.BackgroundColor3 = Color3.new(1, 1, 1)
	bg.Parent = sg
	local grad = Instance.new("UIGradient")
	grad.Color = ColorSequence.new(Color3.fromRGB(40, 16, 90), Color3.fromRGB(120, 20, 80))
	grad.Rotation = 90
	grad.Parent = bg
	local function line(name, y, h, font, color)
		local l = Instance.new("TextLabel")
		l.Name = name
		l.BackgroundTransparency = 1
		l.Position = UDim2.fromScale(0.06, y)
		l.Size = UDim2.fromScale(0.88, h)
		l.Font = font
		l.TextScaled = true
		l.TextColor3 = color
		l.Text = ""
		l.Parent = bg
		telaoText[name] = l
	end
	line("Titulo", 0.06, 0.3, Enum.Font.GothamBlack, Color3.new(1, 1, 1))
	line("Chamada", 0.38, 0.1, Enum.Font.GothamBold, Color3.fromRGB(37, 244, 238))
	line("Contagem", 0.55, 0.13, Enum.Font.GothamBlack, Color3.new(1, 1, 1))
	line("Top", 0.75, 0.1, Enum.Font.GothamBold, Color3.fromRGB(255, 210, 63))
	telaoText.Titulo.Text = "AVATARES\nDA LIVE"
	telaoText.Chamada.Text = "Comente seu nick do Roblox"
end

local function updateTelao()
	if not telaoText.Contagem then return end
	local n = countDancers()
	telaoText.Contagem.Text = string.format("💃 %d dançando", n)
	telaoText.Top.Text = topGifter and string.format("🏆 %s · %d moedas", topGifter.name, topGifter.coins) or "🏆 Mande um presente!"
end
updateTelao()

local function removeDancer(id)
	local d = dancers[id]
	if not d then return end
	dancers[id] = nil
	updateTelao()
	if d.model.Parent then
		local root = d.model:FindFirstChild("HumanoidRootPart")
		if root then
			local puff = Instance.new("Part")
			puff.Anchored, puff.CanCollide, puff.Transparency, puff.Size = true, false, 1, Vector3.one
			puff.CFrame = root.CFrame
			puff.Parent = workspace
			local p = Instance.new("ParticleEmitter")
			p.Rate, p.Speed, p.Lifetime, p.SpreadAngle = 0, NumberRange.new(6, 10), NumberRange.new(0.5, 0.8), Vector2.new(180, 180)
			p.Parent = puff
			p:Emit(25)
			Debris:AddItem(puff, 1.5)
		end
		d.model:Destroy()
	end
end

local function removeOldest()
	local oldestId, oldest = nil, math.huge
	for id, d in pairs(dancers) do
		if d.lastSeen < oldest then oldestId, oldest = id, d.lastSeen end
	end
	if oldestId then removeDancer(oldestId) end
end

local function playDance(d, animId, speed)
	if d.track then d.track:Stop(0.25); d.track:Destroy() end
	local anim = Instance.new("Animation")
	anim.AnimationId = animId
	local ok, track = pcall(function() return d.animator:LoadAnimation(anim) end)
	if not ok then warn("[Avatares da Live] Animação falhou: " .. tostring(track)); return end
	track.Looped = true
	track.Priority = Enum.AnimationPriority.Action
	track:Play(0.25, 1, speed or 1)
	d.track = track
end

local SKINS = { Color3.fromRGB(255, 220, 180), Color3.fromRGB(234, 184, 146), Color3.fromRGB(198, 134, 66),
	Color3.fromRGB(141, 85, 36), Color3.fromRGB(90, 56, 37), Color3.fromRGB(245, 205, 48) }
-- Quem manda presente sem ter comentado o nick ganha um avatar padrão com cores aleatórias
local function guestDescription()
	local d = Instance.new("HumanoidDescription")
	local skin = SKINS[math.random(#SKINS)]
	local shirt = Color3.fromHSV(math.random(), 0.65, 0.95)
	local pants = Color3.fromHSV(math.random(), 0.5, 0.45)
	d.HeadColor, d.LeftArmColor, d.RightArmColor = skin, skin, skin
	d.TorsoColor = shirt
	d.LeftLegColor, d.RightLegColor = pants, pants
	return d
end

local function nameTag(model, text)
	local head = model:FindFirstChild("Head")
	if not head then return end
	-- Tamanho em studs: o nome encolhe com a distância, como no Roblox, e quem está atrás fica escondido
	local gui = Instance.new("BillboardGui")
	gui.Name = "NomeLive"
	gui.Size = UDim2.fromScale(5, 0.8)
	gui.StudsOffset = Vector3.new(0, 1.8, 0)
	gui.LightInfluence = 0
	gui.MaxDistance = 150
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.GothamBold
	label.TextScaled = true
	label.TextColor3 = Color3.new(1, 1, 1)
	label.TextStrokeTransparency = 0.2
	label.Text = text
	label.Parent = gui
	gui.Parent = head
end

local function getDescription(userId)
	if not userId then return guestDescription() end
	local desc = descCache[userId]
	if not desc then
		local ok, res = pcall(Players.GetHumanoidDescriptionFromUserId, Players, userId)
		if not ok then warn("[Avatares da Live] Skin de " .. userId .. " falhou: " .. tostring(res)); return guestDescription() end
		desc = res
		descCache[userId] = desc
	end
	return desc:Clone()
end

local function spawnDancer(id, userId, label)
	removeDancer(id)
	local ok, model = pcall(Players.CreateHumanoidModelFromDescription, Players, getDescription(userId), Enum.HumanoidRigType.R15)
	if not ok then warn("[Avatares da Live] Não consegui montar o avatar: " .. tostring(model)); return nil end
	-- Pode ter chegado outro pedido para o mesmo usuário enquanto a skin carregava
	removeDancer(id)
	while countDancers() >= CFG.maxDancers do removeOldest() end

	model.Name = label
	local hum = model:FindFirstChildOfClass("Humanoid")
	hum.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
	hum.BreakJointsOnDeath = false
	local animate = model:FindFirstChild("Animate")
	if animate then animate:Destroy() end
	model.HumanoidRootPart.Anchored = true
	nameTag(model, label)

	local spot = freeSpot()
	model.Parent = folder
	standAt(model, spot)

	local d = {
		model = model, spot = spot, label = label, userId = userId, lastSeen = os.clock(), token = 0,
		animator = hum:FindFirstChildOfClass("Animator") or Instance.new("Animator", hum),
		dance = DANCES[math.random(#DANCES)],
	}
	dancers[id] = d
	updateTelao()
	playDance(d, d.dance, 0.9 + math.random() * 0.3)

	local sparkle = Instance.new("ParticleEmitter")
	sparkle.Rate = 0
	sparkle.Speed = NumberRange.new(4, 8)
	sparkle.SpreadAngle = Vector2.new(180, 180)
	sparkle.Color = ColorSequence.new(Color3.fromRGB(37, 244, 238), Color3.fromRGB(254, 44, 85))
	sparkle.LightEmission = 1
	sparkle.Parent = model.HumanoidRootPart
	sparkle:Emit(30)
	Debris:AddItem(sparkle, 2)
	return d
end

-- ========== Efeitos dos presentes ==========
-- Cada efeito novo invalida o anterior do mesmo avatar (token), para o "voltar ao normal" não atropelar outro
local function effectEnd(d, fn)
	d.token += 1
	local token = d.token
	task.delay(CFG.effectSeconds, function()
		if d.token == token and d.model.Parent then fn() end
	end)
end

local function addAura(d, color)
	local root = d.model.HumanoidRootPart
	local aura = Instance.new("ParticleEmitter")
	aura.Name = "AuraLive"
	aura.Color = ColorSequence.new(color)
	aura.LightEmission = 0.6
	aura.Rate = 35
	aura.Lifetime = NumberRange.new(0.8, 1.4)
	aura.Speed = NumberRange.new(1.5, 3)
	aura.SpreadAngle = Vector2.new(180, 180)
	aura.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.6), NumberSequenceKeypoint.new(1, 0) })
	aura.Parent = root
	local light = Instance.new("PointLight")
	light.Color, light.Brightness, light.Range = color, 1.2, 10
	light.Parent = root
	Debris:AddItem(aura, CFG.effectSeconds)
	Debris:AddItem(light, CFG.effectSeconds)
end

local EFFECTS = {}

function EFFECTS.danca(d)
	local special
	repeat special = DANCES[math.random(#DANCES)] until special ~= d.dance or #DANCES == 1
	playDance(d, special, 1.35)
	local sparkles = Instance.new("Sparkles")
	sparkles.SparkleColor = Color3.fromRGB(254, 44, 85)
	sparkles.Parent = d.model.HumanoidRootPart
	Debris:AddItem(sparkles, CFG.effectSeconds)
	effectEnd(d, function() playDance(d, d.dance, 1) end)
end

function EFFECTS.aura(d)
	addAura(d, Color3.fromHSV(math.random(), 0.8, 1))
	playDance(d, CHEER, 1)
	effectEnd(d, function() playDance(d, d.dance, 1) end)
end

function EFFECTS.gigante(d)
	d.model:ScaleTo(CFG.giantScale)
	standAt(d.model, d.spot)
	addAura(d, Color3.fromRGB(255, 210, 63))
	effectEnd(d, function()
		d.model:ScaleTo(1)
		standAt(d.model, d.spot)
	end)
end

local rainSources = {}
function EFFECTS.chuva(d, count)
	EFFECTS.danca(d)
	-- Chove a skin de quem está no palco; com o palco vazio, avatares padrão
	local sources = {}
	for _, other in pairs(dancers) do table.insert(sources, other.model) end
	if #sources == 0 then
		if #rainSources == 0 then
			for _ = 1, 4 do
				local ok, m = pcall(Players.CreateHumanoidModelFromDescription, Players, guestDescription(), Enum.HumanoidRigType.R15)
				if ok then table.insert(rainSources, m) end
			end
		end
		sources = rainSources
	end
	if #sources == 0 then return end

	local total = CFG.rainCount * math.min(count, 3)
	for k = 1, total do
		local m = sources[math.random(#sources)]:Clone()
		for _, item in ipairs(m:GetDescendants()) do
			if item:IsA("BillboardGui") or item:IsA("ParticleEmitter") or item:IsA("Sparkles") or item:IsA("PointLight") then item:Destroy() end
		end
		if m:FindFirstChild("Animate") then m.Animate:Destroy() end
		m:ScaleTo(1)
		local hum = m:FindFirstChildOfClass("Humanoid")
		hum.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
		hum.BreakJointsOnDeath = false
		local x = (math.random() - 0.5) * stageSize.X
		local z = (math.random() - 0.5) * stageSize.Z
		local pos = (stageCF * CFrame.new(x, stageSize.Y / 2 + 40 + math.random() * 30, z)).Position
		m:PivotTo(CFrame.new(pos) * CFrame.Angles(math.random() * 6.28, math.random() * 6.28, 0))
		m.HumanoidRootPart.Anchored = false
		m.Parent = folder
		hum:ChangeState(Enum.HumanoidStateType.Physics) -- cai rodando, sem tentar ficar de pé
		m.HumanoidRootPart.AssemblyAngularVelocity = Vector3.new(math.random(-6, 6), math.random(-6, 6), math.random(-6, 6))
		Debris:AddItem(m, 7)
		if k % 6 == 0 then task.wait(0.05) end
	end
end

-- ========== Eventos da live ==========
local function parseNick(text)
	text = (text or ""):match("^%s*(.-)%s*$")
	local nick = text:match("^@?([%w_]+)$")
	if not nick or #nick < 3 or #nick > 20 then return nil end
	if nick:match("^_") or nick:match("_$") or select(2, nick:gsub("_", "")) > 1 then return nil end
	local low = nick:lower()
	if low:match("^%d+$") or low:match("^k+$") or low:match("^[ah]+$") or low:match("^[eh]+$") or low:match("^[rs]+$") or IGNORE[low] then return nil end
	return nick
end

local function userIdFromName(nick)
	local key = nick:lower()
	if nameCache[key] then return nameCache[key] end
	if missCache[key] and os.clock() - missCache[key] < 120 then return nil end
	local ok, id = pcall(Players.GetUserIdFromNameAsync, Players, nick)
	if ok and id then nameCache[key] = id; return id end
	missCache[key] = os.clock()
	return nil
end

local lastComment = {}

local function onComment(e)
	local id = e.user.id
	local nick = parseNick(e.text)
	if not nick then return end
	local now = os.clock()
	if lastComment[id] and now - lastComment[id] < CFG.commentCooldown then return end
	lastComment[id] = now

	local current = dancers[id]
	if current and current.label:lower() == nick:lower() then
		current.lastSeen = now -- já está no palco: só renova
		return
	end
	local userId = userIdFromName(nick)
	if not userId then return end
	local d = spawnDancer(id, userId, nick)
	if d then feed(nick .. " entrou na pista", "💃 dançando", userId, nil, nil) end
end

local function onGift(e)
	local gift = e.gift or {}
	local name = tostring(gift.name or "Presente")
	local key = name:lower()
	local count = math.max(1, tonumber(gift.count) or 1)
	local coins = tonumber(gift.coins) or 1
	local action = GIFT_ACTIONS[key] or actionByCoins(coins)

	local id = e.user.id
	local d = dancers[id]
	if not d then
		d = spawnDancer(id, nil, e.user.nickname or id)
		if not d then return end
	end
	d.lastSeen = os.clock()
	EFFECTS[action](d, count)
	if action == "chuva" or action == "gigante" then flash(Color3.fromRGB(255, 210, 63))
	elseif action == "aura" then flash(Color3.fromHSV(math.random(), 0.8, 1)) end

	local g = topGift[id] or { name = e.user.nickname or id, coins = 0 }
	topGift[id] = g
	g.coins += coins * count
	if not topGifter or g.coins > topGifter.coins then topGifter = g end
	updateTelao()
	feed(string.format("%s mandou %s%s", e.user.nickname or id, name, count > 1 and (" ×" .. count) or ""),
		ACTION_LABEL[action], d.userId, GIFT_ICONS[key] or "🎁", action == "chuva" and Color3.fromRGB(255, 210, 63) or nil)
end

local queue = {}
local function handle(e)
	if not e.user then return end
	if e.type == "comment" then onComment(e)
	elseif e.type == "gift" then onGift(e) end
end

-- Um evento por vez: buscar skin espera a resposta do Roblox, e a ordem do chat fica preservada
task.spawn(function()
	while true do
		local e = table.remove(queue, 1)
		if e then
			local ok, err = pcall(handle, e)
			if not ok then warn("[Avatares da Live] Erro no evento: " .. tostring(err)) end
		else
			task.wait(0.05)
		end
	end
end)

local function enqueue(e)
	-- Live muito movimentada: descarta comentários antigos, nunca presentes
	if #queue > 60 and e.type == "comment" then return end
	table.insert(queue, e)
end

-- ========== Limpeza ==========
task.spawn(function()
	while true do
		task.wait(5)
		local now = os.clock()
		for id, d in pairs(dancers) do
			if now - d.lastSeen > CFG.idleSeconds then removeDancer(id) end
		end
	end
end)

-- ========== Conexão com o launcher ==========
local STATUS_TEXT = {
	connected = "Conectado à live",
	connecting = "Conectando na live...",
}
task.spawn(function()
	local since = nil
	while true do
		local url = since and (CFG.url .. "?since=" .. since) or CFG.url
		local ok, res = pcall(HttpService.GetAsync, HttpService, url, true)
		if ok then
			local okJson, data = pcall(HttpService.JSONDecode, HttpService, res)
			if okJson and type(data) == "table" then
				local st = data.status or {}
				if st.state == "connected" then
					setLink(true, st.mode == "sim" and "Simulação do launcher" or STATUS_TEXT.connected)
				else
					setLink(false, STATUS_TEXT[st.state] or "Launcher aberto, live desconectada")
				end
				for _, e in ipairs(data.events or {}) do enqueue(e) end
				since = data.seq
			else
				task.wait(1)
			end
		else
			local msg = tostring(res)
			if msg:find("not enabled") or msg:find("HttpEnabled") then
				setLink(false, "Ative Game Settings > Security > Allow HTTP Requests")
				task.wait(5)
			else
				setLink(false, "Abra o Live Arcade neste computador")
				since = nil
				task.wait(2)
			end
		end
	end
end)
