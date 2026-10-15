-- Avatares da Live — tela do streamer (LocalScript em StarterPlayer > StarterPlayerScripts)
-- Câmera fixa no palco (peça "CameraLive") e avisos de quem entrou ou mandou presente.
-- A interface fica numa faixa central 9:16, que é a parte da janela recortada para a live vertical.
-- Tecla G mostra/esconde a moldura da faixa, para acertar o recorte no TikTok LIVE Studio / OBS.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local StarterGui = game:GetService("StarterGui")
local TweenService = game:GetService("TweenService")
local TextChatService = game:GetService("TextChatService")
local UserInputService = game:GetService("UserInputService")

local player = Players.LocalPlayer
local VERTICAL = true -- false: usa a janela inteira (live horizontal)
local ACCENT = Color3.fromRGB(37, 244, 238)
local MAX_TOASTS = 3
local TOAST_SECONDS = 7

-- Tela limpa para a captura: sem chat, lista de jogadores e botões do Roblox no topo.
-- A interface do Roblox carrega aos poucos e religa partes dela, então reaplica nos primeiros segundos.
task.spawn(function()
	for _ = 1, 30 do
		pcall(StarterGui.SetCoreGuiEnabled, StarterGui, Enum.CoreGuiType.All, false)
		pcall(StarterGui.SetCore, StarterGui, "TopbarEnabled", false)
		for _, name in ipairs({ "ChatWindowConfiguration", "ChatInputBarConfiguration" }) do
			local conf = TextChatService:FindFirstChild(name)
			if conf then pcall(function() conf.Enabled = false end) end
		end
		task.wait(0.5)
	end
end)

-- ========== Câmera ==========
task.spawn(function()
	local camPart = workspace:WaitForChild("CameraLive", 30)
	if not camPart then return end
	local function fix()
		local cam = workspace.CurrentCamera
		cam.CameraType = Enum.CameraType.Scriptable
		cam.FieldOfView = camPart:GetAttribute("FOV") or 70
		cam.CFrame = camPart.CFrame
	end
	fix()
	camPart:GetPropertyChangedSignal("CFrame"):Connect(fix)
	-- O Roblox devolve a câmera ao modo normal em algumas situações
	workspace.CurrentCamera:GetPropertyChangedSignal("CameraType"):Connect(function()
		if workspace.CurrentCamera.CameraType ~= Enum.CameraType.Scriptable then task.defer(fix) end
	end)
end)

-- ========== Interface ==========
local gui = Instance.new("ScreenGui")
gui.Name = "AvataresDaLive"
gui.IgnoreGuiInset = true
gui.ResetOnSpawn = false
gui.Parent = player:WaitForChild("PlayerGui")

-- Faixa central: tudo abaixo é medido em proporção dela, então o visual é igual em qualquer tamanho de janela
local safe = Instance.new("Frame")
safe.Name = "Faixa"
safe.AnchorPoint = Vector2.new(0.5, 0.5)
safe.Position = UDim2.fromScale(0.5, 0.5)
safe.Size = UDim2.fromScale(1, 1)
safe.BackgroundTransparency = 1
safe.Parent = gui
if VERTICAL then
	local ar = Instance.new("UIAspectRatioConstraint")
	ar.AspectRatio = 9 / 16
	ar.AspectType = Enum.AspectType.FitWithinMaxSize
	ar.Parent = safe
end

local guide = Instance.new("UIStroke")
guide.Color = Color3.fromRGB(255, 210, 63)
guide.Thickness = 3
guide.Enabled = false
guide.Parent = safe
UserInputService.InputBegan:Connect(function(input, processed)
	if not processed and input.KeyCode == Enum.KeyCode.G then guide.Enabled = not guide.Enabled end
end)

local function corner(parent, scale)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(scale, 0)
	c.Parent = parent
end

local function stroke(parent, color, t)
	local s = Instance.new("UIStroke")
	s.Color, s.Thickness, s.Transparency = color, 2, t or 0.2
	s.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	s.Parent = parent
end

local function label(parent, font, color)
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Font = font
	l.TextScaled = true
	l.TextColor3 = color
	l.Parent = parent
	return l
end

-- Chamada no topo
local header = Instance.new("Frame")
header.AnchorPoint = Vector2.new(0.5, 0)
header.Position = UDim2.fromScale(0.5, 0.03)
header.Size = UDim2.fromScale(0.9, 0.075)
header.BackgroundColor3 = Color3.fromRGB(14, 14, 24)
header.BackgroundTransparency = 0.15
header.Parent = safe
corner(header, 0.25)
stroke(header, ACCENT)
local headTop = label(header, Enum.Font.GothamBlack, Color3.new(1, 1, 1))
headTop.Position = UDim2.fromScale(0.05, 0.08)
headTop.Size = UDim2.fromScale(0.9, 0.52)
headTop.Text = "COMENTE SEU NICK DO ROBLOX"
local headSub = label(header, Enum.Font.GothamBold, ACCENT)
headSub.Position = UDim2.fromScale(0.05, 0.6)
headSub.Size = UDim2.fromScale(0.9, 0.3)
headSub.Text = "e apareça dançando com a sua skin 💃"

-- Situação da conexão (rodapé da faixa)
local status = label(safe, Enum.Font.GothamBold, Color3.fromRGB(255, 120, 120))
status.Position = UDim2.fromScale(0.05, 0.955)
status.Size = UDim2.fromScale(0.9, 0.022)
status.TextXAlignment = Enum.TextXAlignment.Left
status.TextStrokeTransparency = 0.4
status.Text = "● Procurando o Live Arcade..."

-- Avisos no chão vazio abaixo do palco, para não cobrir o telão; o mais novo entra embaixo
local list = Instance.new("Frame")
list.Position = UDim2.fromScale(0.04, 0.735)
list.Size = UDim2.fromScale(0.7, 0.21)
list.BackgroundTransparency = 1
list.Parent = safe
local layout = Instance.new("UIListLayout")
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.VerticalAlignment = Enum.VerticalAlignment.Bottom
layout.Padding = UDim.new(0.04, 0)
layout.Parent = list

local order = 0
local function toast(data)
	order += 1
	local color = data.color or ACCENT

	local card = Instance.new("Frame")
	card.LayoutOrder = order
	card.Size = UDim2.fromScale(1, 0.3)
	card.BackgroundColor3 = Color3.fromRGB(16, 16, 28)
	card.BackgroundTransparency = 0.1
	corner(card, 0.2)
	stroke(card, color, 0.35)

	local icon
	if data.userId then
		icon = Instance.new("ImageLabel")
		icon.Image = string.format("rbxthumb://type=AvatarHeadShot&id=%d&w=150&h=150", data.userId)
		icon.BackgroundColor3 = Color3.fromRGB(40, 40, 60)
	else
		icon = label(card, Enum.Font.GothamBold, Color3.new(1, 1, 1))
		icon.Text = data.icon or "🎁"
	end
	icon.AnchorPoint = Vector2.new(0, 0.5)
	icon.Position = UDim2.fromScale(0.03, 0.5)
	icon.Size = UDim2.fromScale(0.75, 0.75)
	icon.SizeConstraint = Enum.SizeConstraint.RelativeYY
	icon.Parent = card
	corner(icon, 0.5)

	local title = label(card, Enum.Font.GothamBold, Color3.new(1, 1, 1))
	title.Position = UDim2.fromScale(0.22, 0.12)
	title.Size = UDim2.fromScale(0.74, 0.42)
	title.TextXAlignment = Enum.TextXAlignment.Left
	title.TextTruncate = Enum.TextTruncate.AtEnd
	title.Text = data.title or ""

	local sub = label(card, Enum.Font.Code, color)
	sub.Position = UDim2.fromScale(0.22, 0.56)
	sub.Size = UDim2.fromScale(0.74, 0.32)
	sub.TextXAlignment = Enum.TextXAlignment.Left
	sub.Text = data.sub or ""

	-- Textos do mesmo tamanho em todos os avisos, mesmo com nomes compridos
	for _, l in ipairs({ title, sub }) do
		local c = Instance.new("UITextSizeConstraint")
		c.MaxTextSize = l == title and 30 or 24
		c.Parent = l
	end

	card.Parent = list
	local cards = {}
	for _, c in ipairs(list:GetChildren()) do if c:IsA("Frame") then table.insert(cards, c) end end
	table.sort(cards, function(a, b) return a.LayoutOrder > b.LayoutOrder end)
	for i = MAX_TOASTS + 1, #cards do cards[i]:Destroy() end

	task.delay(TOAST_SECONDS, function()
		if not card.Parent then return end
		local info = TweenInfo.new(0.4)
		for _, item in ipairs(card:GetDescendants()) do
			if item:IsA("TextLabel") then TweenService:Create(item, info, { TextTransparency = 1 }):Play() end
			if item:IsA("ImageLabel") then TweenService:Create(item, info, { ImageTransparency = 1, BackgroundTransparency = 1 }):Play() end
			if item:IsA("UIStroke") then TweenService:Create(item, info, { Transparency = 1 }):Play() end
		end
		TweenService:Create(card, info, { BackgroundTransparency = 1 }):Play()
		task.wait(0.45)
		card:Destroy()
	end)
end

local remote = ReplicatedStorage:WaitForChild("AvataresFeed")
remote.OnClientEvent:Connect(function(kind, data)
	if kind == "feed" then
		toast(data)
	elseif kind == "status" then
		status.Text = "● " .. data.text
		status.TextColor3 = data.ok and Color3.fromRGB(80, 230, 140) or Color3.fromRGB(255, 120, 120)
	end
end)
